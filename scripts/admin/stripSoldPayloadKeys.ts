/**
 * Applies migration 102: strips 'media' and 'PrivateRemarks' from
 * raw_vow_sold.raw_payload. DESTRUCTIVE — see the migration file for pre-conditions
 * and rollback.
 *
 * Batched by listing_key with a VACUUM every VACUUM_EVERY batches. This rewrites the
 * raw_payload TOAST for every row, so doing it in one statement would need the new
 * copy of the whole table before any old pages could be freed — production disk is
 * ~70% full. Batching + interleaved VACUUM keeps the peak bounded because each batch
 * reuses pages the previous one released.
 *
 * Refuses to run unless every row has `photos` populated, so it cannot delete photos
 * that were never extracted.
 *
 * Idempotent and resumable: only rows still holding either key are touched.
 *
 * Usage:
 *   npx tsx scripts/admin/stripSoldPayloadKeys.ts                  # dry-run
 *   npx tsx scripts/admin/stripSoldPayloadKeys.ts --apply --limit 2000
 *   npx tsx scripts/admin/stripSoldPayloadKeys.ts --apply
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const ROW_LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;
const BATCH = 4000;
// Every VACUUM_EVERY batches. This is the knob that controls PEAK disk: the strip
// writes a new (smaller) row version per row and orphans the old raw_payload TOAST
// chunks, and plain VACUUM makes those pages reusable so later batches land in them
// instead of extending the file. Vacuum too rarely and the table grows by roughly its
// own size before any reuse kicks in — which matters at ~70% disk.
const VACUUM_EVERY = 3;

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

async function main() {
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  console.log(`✅ connected — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  try {
    // ---- Guard: never strip media from a row whose photos were not extracted.
    // Two separate cheap queries rather than one FILTER pass. The old form made the
    // planner evaluate the jsonb_array_elements EXISTS for every row holding media
    // (~270k detoasts, ~10 min). Narrowing on `jsonb_array_length(photos) = 0` first
    // reduces the expensive check to the handful of rows that could actually lose a
    // photo — same guarantee, seconds instead of minutes.
    const { rows: [g1] } = await c.query(
      `SELECT count(*)::int AS missing_photos FROM raw_vow_sold WHERE photos IS NULL`);
    const { rows: [g2] } = await c.query(`
      SELECT count(*)::int AS would_lose_photos
      FROM raw_vow_sold
      WHERE jsonb_array_length(photos) = 0
        AND raw_payload ? 'media'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(raw_payload->'media') e
                    WHERE e->>'MediaURL' IS NOT NULL
                      AND COALESCE(e->>'MediaStatus','') <> 'Deleted')`);
    const g = { missing_photos: g1.missing_photos, would_lose_photos: g2.would_lose_photos };
    if (g.missing_photos > 0) {
      console.error(`❌ ABORT: ${g.missing_photos} rows have no photos column yet. Run backfillSoldPhotos.ts first.`);
      process.exit(1);
    }
    if (g.would_lose_photos > 0) {
      console.error(`❌ ABORT: ${g.would_lose_photos} rows still have usable media that did NOT make it into photos.`);
      process.exit(1);
    }
    console.log('✅ guard: every row has photos, and no row would lose a usable photo\n');

    const { rows: [pre] } = await c.query(`
      SELECT count(*) FILTER (WHERE raw_payload ? 'media')::int AS with_media,
             count(*) FILTER (WHERE raw_payload ? 'PrivateRemarks')::int AS with_privrem,
             count(*) FILTER (WHERE raw_payload ? 'media' OR raw_payload ? 'PrivateRemarks')::int AS todo,
             pg_size_pretty(pg_total_relation_size('raw_vow_sold')) AS size
      FROM raw_vow_sold`);
    console.log(`   raw_vow_sold is ${pre.size}`);
    console.log(`   ${pre.with_media} rows carry 'media', ${pre.with_privrem} carry 'PrivateRemarks' — ${pre.todo} to strip\n`);

    if (!APPLY) {
      console.log('(dry-run — nothing written. Re-run with --apply)');
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
           WHERE (raw_payload ? 'media' OR raw_payload ? 'PrivateRemarks')
             AND listing_key > $1
           ORDER BY listing_key LIMIT $2
         )
         UPDATE raw_vow_sold t
            SET raw_payload = t.raw_payload - 'media' - 'PrivateRemarks'
           FROM page WHERE t.listing_key = page.listing_key
         RETURNING t.listing_key`,
        [cursor, size]
      );
      if (rows.length === 0) break;
      cursor = rows.map((r) => r.listing_key).sort().at(-1)!;
      done += rows.length;
      batches++;
      if (batches % VACUUM_EVERY === 0) {
        await c.query('VACUUM raw_vow_sold');
        const el = (Date.now() - t0) / 1000;
        const { rows: [s] } = await c.query(`SELECT pg_size_pretty(pg_total_relation_size('raw_vow_sold')) sz`);
        console.log(`   ${done} rows (${(done / el).toFixed(0)}/s) — table now ${s.sz}, cursor ${cursor}`);
      }
    }
    console.log('\n   final VACUUM (ANALYZE)…');
    await c.query('VACUUM (ANALYZE) raw_vow_sold');

    const { rows: [post] } = await c.query(`
      SELECT count(*) FILTER (WHERE raw_payload ? 'media')::int AS with_media,
             count(*) FILTER (WHERE raw_payload ? 'PrivateRemarks')::int AS with_privrem,
             count(*) FILTER (WHERE jsonb_array_length(photos) > 0)::int AS rows_with_photos,
             round(avg(jsonb_array_length(photos)) FILTER (WHERE jsonb_array_length(photos) > 0), 1) AS avg_photos,
             pg_size_pretty(pg_total_relation_size('raw_vow_sold')) AS size
      FROM raw_vow_sold`);
    console.log(`\n✅ stripped ${done} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    console.log(`   raw_vow_sold now ${post.size} (was ${pre.size})`);
    console.log(`   remaining: ${post.with_media} with 'media', ${post.with_privrem} with 'PrivateRemarks'`);
    console.log(`   photos intact: ${post.rows_with_photos} rows, avg ${post.avg_photos} each`);

    if (post.with_media === 0 && post.with_privrem === 0) {
      await c.query(
        `INSERT INTO public.schema_migrations (filename, applied_via)
         VALUES ('102_strip_sold_payload_media.sql','apply') ON CONFLICT DO NOTHING`);
      console.log('   ledger: 102 recorded');
    }
  } finally {
    await c.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
