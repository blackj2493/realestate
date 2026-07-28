/**
 * Backfill raw_vow_sold.photos from raw_payload->'media' (migration 101).
 *
 * Part 1 of 2. This is ADDITIVE — raw_payload is not touched, so nothing changes
 * behaviourally: readers still use raw_payload->'media' until they are repointed.
 * That makes this step independently safe and verifiable.
 *
 * Extraction mirrors src/lib/etl/selectPrimaryImage.ts:collectMediaUrls exactly —
 * MediaStatus='Deleted' excluded, deduplicated by URL, Order preserved — so the sold
 * path and the active-listing path agree on what "the photos" are. Captions
 * (ShortDescription, present on 8.3%) are carried through for the sold detail page.
 *
 * Pacing: keyset-paginated by listing_key in batches, with a plain VACUUM every
 * VACUUM_EVERY batches so the heap reuses its own freed space instead of growing the
 * file (production disk is ~70% full). Updating `photos` does NOT rewrite the
 * raw_payload TOAST — unchanged out-of-line values are reused by the new row version —
 * so this pass is far cheaper than the strip in part 2.
 *
 * Idempotent and resumable: only rows WHERE photos IS NULL are touched, so a re-run
 * continues where it stopped. Rows whose media is absent/empty get '[]' (not NULL) so
 * they are not retried forever.
 *
 * Usage:
 *   npx tsx scripts/admin/backfillSoldPhotos.ts                 # dry-run, samples 500
 *   npx tsx scripts/admin/backfillSoldPhotos.ts --apply --limit 500
 *   npx tsx scripts/admin/backfillSoldPhotos.ts --apply
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const ROW_LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;
const BATCH = 2000;
const VACUUM_EVERY = 10;

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

/** The extraction, as a SQL expression. Kept in one place so dry-run and apply agree. */
const PHOTOS_EXPR = `
  COALESCE((
    SELECT jsonb_agg(x ORDER BY ord)
    FROM (
      SELECT DISTINCT ON (e->>'MediaURL')
             (e->>'Order')::int AS ord,
             CASE WHEN NULLIF(e->>'ShortDescription','') IS NULL
                  THEN jsonb_build_object('u', e->>'MediaURL')
                  ELSE jsonb_build_object('u', e->>'MediaURL', 'c', e->>'ShortDescription') END AS x
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(t.raw_payload->'media')='array'
                  THEN t.raw_payload->'media' ELSE '[]'::jsonb END) e
      WHERE e->>'MediaURL' IS NOT NULL
        AND COALESCE(e->>'MediaStatus','') <> 'Deleted'
      ORDER BY e->>'MediaURL', (e->>'Order')::int
    ) q
  ), '[]'::jsonb)`;

async function main() {
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  console.log(`✅ connected — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  try {
    const { rows: [pre] } = await c.query(
      `SELECT count(*)::int total, count(photos)::int done, count(*) FILTER (WHERE photos IS NULL)::int todo
       FROM raw_vow_sold`);
    console.log(`   ${pre.total} sold rows — ${pre.done} already have photos, ${pre.todo} to go\n`);

    if (!APPLY) {
      const { rows } = await c.query(`
        SELECT listing_key,
               jsonb_array_length(${PHOTOS_EXPR}) AS extracted,
               jsonb_array_length(CASE WHEN jsonb_typeof(raw_payload->'media')='array'
                                       THEN raw_payload->'media' ELSE '[]'::jsonb END) AS raw_elements
        FROM raw_vow_sold t WHERE photos IS NULL ORDER BY listing_key LIMIT 500`);
      const kept = rows.reduce((s, r) => s + Number(r.extracted), 0);
      const raw = rows.reduce((s, r) => s + Number(r.raw_elements), 0);
      console.log(`   sample of ${rows.length}: ${raw} raw media elements -> ${kept} kept ` +
                  `(${raw ? (100 * (1 - kept / raw)).toFixed(1) : '0'}% dropped as Deleted/duplicate)`);
      console.log(`   e.g. ${rows.slice(0, 3).map(r => `${r.listing_key}: ${r.raw_elements}->${r.extracted}`).join(', ')}`);
      console.log('\n(dry-run — nothing written. Re-run with --apply)');
      return;
    }

    let cursor = '';
    let done = 0, batches = 0;
    const t0 = Date.now();
    for (;;) {
      if (done >= ROW_LIMIT) break;
      const size = Math.min(BATCH, ROW_LIMIT - done);
      const { rows } = await c.query(
        `WITH page AS (
           SELECT listing_key FROM raw_vow_sold
           WHERE photos IS NULL AND listing_key > $1
           ORDER BY listing_key LIMIT $2
         )
         UPDATE raw_vow_sold t SET photos = ${PHOTOS_EXPR}
         FROM page WHERE t.listing_key = page.listing_key
         RETURNING t.listing_key`,
        [cursor, size]
      );
      if (rows.length === 0) break;
      cursor = rows.map(r => r.listing_key).sort().at(-1)!;
      done += rows.length;
      batches++;
      if (batches % VACUUM_EVERY === 0) {
        await c.query('VACUUM raw_vow_sold');
        const el = (Date.now() - t0) / 1000;
        console.log(`   ${done} rows (${(done / el).toFixed(0)}/s) — vacuumed, cursor ${cursor}`);
      }
    }
    await c.query('VACUUM (ANALYZE) raw_vow_sold');

    const { rows: [post] } = await c.query(
      `SELECT count(photos)::int done, count(*) FILTER (WHERE photos IS NULL)::int todo,
              round(avg(jsonb_array_length(photos)) FILTER (WHERE jsonb_array_length(photos) > 0), 1) AS avg_photos,
              count(*) FILTER (WHERE jsonb_array_length(photos) = 0)::int AS rows_no_photos
       FROM raw_vow_sold`);
    console.log(`\n✅ backfilled ${done} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    console.log(`   ${post.done} rows have photos (${post.todo} still null), avg ${post.avg_photos} photos, ${post.rows_no_photos} with none`);
  } finally {
    await c.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
