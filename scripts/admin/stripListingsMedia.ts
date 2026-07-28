/**
 * Applies migration 103: strips 'media' from listings.full_payload.
 * DESTRUCTIVE — see the migration file for pre-conditions and rollback.
 *
 * Batched by listing_key with an interleaved VACUUM, for the same reason as the sold
 * strip: one statement over 231k rows would need a full second copy of the TOAST before
 * anything could be freed. Batching + VACUUM keeps peak disk flat (the sold table grew
 * ~105 MB total, then plateaued).
 *
 * Refuses to run if any row would be left without photos.
 *
 * Idempotent and resumable: only rows still holding the key are touched.
 *
 * Usage:
 *   npx tsx scripts/admin/stripListingsMedia.ts                 # dry-run
 *   npx tsx scripts/admin/stripListingsMedia.ts --apply --limit 2000
 *   npx tsx scripts/admin/stripListingsMedia.ts --apply
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const ROW_LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;
const BATCH = 4000;
// Measured: the first 12,000 rows moved the table 5,631 MB -> 5,631 MB, i.e. no growth
// at all, because the stripped payload is strictly smaller than what it replaces and
// listings already carries ~69% empty heap pages to land in. So the frequent VACUUM the
// sold strip needed is pure overhead here — a pass over 5.6 GB was costing roughly as
// much wall-clock as the updates themselves. Kept non-zero so free space is still
// recycled and n_dead_tup cannot run away over a multi-hour run.
const VACUUM_EVERY = 10;

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

async function main() {
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  console.log(`✅ connected — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  try {
    // Guard: a row must never end up with photos in the payload but none in media_urls.
    // Narrow on the cheap array check first so the jsonb_array_elements EXISTS only
    // runs for the handful of candidates, not all 231k rows.
    const { rows: [g] } = await c.query(`
      SELECT count(*)::int AS would_lose_photos
      FROM listings
      WHERE COALESCE(cardinality(media_urls), 0) = 0
        AND full_payload ? 'media'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(full_payload->'media') e
                    WHERE e->>'MediaURL' IS NOT NULL
                      AND COALESCE(e->>'MediaStatus','') <> 'Deleted')`);
    if (g.would_lose_photos > 0) {
      console.error(`❌ ABORT: ${g.would_lose_photos} rows have usable photos in the payload but an empty media_urls.`);
      console.error('   Populate media_urls for those first (scripts/admin/backfillMedia.ts).');
      process.exit(1);
    }
    console.log('✅ guard: no row would be left without photos\n');

    const { rows: [pre] } = await c.query(`
      SELECT count(*) FILTER (WHERE full_payload ? 'media')::int AS todo,
             count(*)::int AS total,
             pg_size_pretty(pg_total_relation_size('listings')) AS size
      FROM listings`);
    console.log(`   listings is ${pre.size} — ${pre.todo} of ${pre.total} rows carry 'media'\n`);

    if (!APPLY) { console.log('(dry-run — nothing written. Re-run with --apply)'); return; }

    let cursor = '';
    let done = 0, batches = 0;
    const t0 = Date.now();
    for (;;) {
      if (done >= ROW_LIMIT) break;
      const size = Math.min(BATCH, ROW_LIMIT - done);
      const { rows } = await c.query(
        `WITH page AS (
           SELECT listing_key FROM listings
           WHERE full_payload ? 'media' AND listing_key > $1
           ORDER BY listing_key LIMIT $2
         )
         UPDATE listings t SET full_payload = t.full_payload - 'media'
           FROM page WHERE t.listing_key = page.listing_key
         RETURNING t.listing_key`,
        [cursor, size]
      );
      if (rows.length === 0) break;
      cursor = rows.map((r) => r.listing_key).sort().at(-1)!;
      done += rows.length;
      batches++;
      if (batches % VACUUM_EVERY === 0) {
        await c.query('VACUUM listings');
        const el = (Date.now() - t0) / 1000;
        const { rows: [s] } = await c.query(`SELECT pg_size_pretty(pg_total_relation_size('listings')) sz`);
        console.log(`   ${done} rows (${(done / el).toFixed(0)}/s) — table now ${s.sz}, cursor ${cursor}`);
      }
    }
    console.log('\n   final VACUUM (ANALYZE)…');
    await c.query('VACUUM (ANALYZE) listings');

    const { rows: [post] } = await c.query(`
      SELECT count(*) FILTER (WHERE full_payload ? 'media')::int AS media_left,
             count(*) FILTER (WHERE cardinality(media_urls) > 0)::int AS rows_with_photos,
             round(avg(cardinality(media_urls)) FILTER (WHERE cardinality(media_urls) > 0), 1) AS avg_urls,
             pg_size_pretty(pg_total_relation_size('listings')) AS size
      FROM listings`);
    console.log(`\n✅ stripped ${done} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    console.log(`   listings now ${post.size} (was ${pre.size})`);
    console.log(`   remaining with 'media': ${post.media_left}`);
    console.log(`   photos intact: ${post.rows_with_photos} rows, avg ${post.avg_urls} urls`);

    if (post.media_left === 0) {
      await c.query(
        `INSERT INTO public.schema_migrations (filename, applied_via)
         VALUES ('103_strip_listings_payload_media.sql','apply') ON CONFLICT DO NOTHING`);
      console.log('   ledger: 103 recorded');
    }
  } finally {
    await c.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
