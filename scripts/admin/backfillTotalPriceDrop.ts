// scripts/admin/backfillTotalPriceDrop.ts
/**
 * One-time backfill of listings.total_price_drop from full_payload (migration 074).
 * Detoast-heavy → gentle batches (same pattern as backfillFlatStatusEntry). Absent →
 * 0 (no known cut), so the `total_price_drop IS NULL` batch marker always clears.
 *
 * Run: npx tsx scripts/admin/backfillTotalPriceDrop.ts
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }
const BATCH = 2500, PAUSE_MS = 200;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const UPDATE_SQL = `
  WITH batch AS (SELECT listing_key FROM listings WHERE total_price_drop IS NULL LIMIT ${BATCH})
  UPDATE listings l
  SET total_price_drop = coalesce(NULLIF(l.full_payload->>'total_price_drop','')::numeric, 0)
  FROM batch b WHERE l.listing_key = b.listing_key`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('✅ connected — backfilling listings.total_price_drop');
  const { rows: [{ todo }] } = await client.query(`SELECT count(*) FILTER (WHERE total_price_drop IS NULL)::int todo FROM listings`);
  console.log(`   ${todo} rows to backfill (batch ${BATCH})`);
  const t0 = Date.now();
  let done = 0, batches = 0;
  for (;;) {
    await client.query(`SET statement_timeout = '120s'`);
    const res = await client.query(UPDATE_SQL);
    const n = res.rowCount ?? 0;
    if (n === 0) break;
    done += n; batches++;
    if (batches % 10 === 0) console.log(`   ${done}/${todo} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    await sleep(PAUSE_MS);
  }
  const { rows: [chk] } = await client.query(`SELECT count(*) FILTER (WHERE total_price_drop IS NULL)::int still_null, count(*) FILTER (WHERE total_price_drop > 0)::int with_cut FROM listings`);
  console.log(`\n✅ done in ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min · ${done} updated · NULL=${chk.still_null} · with_cut=${chk.with_cut}`);
  await client.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
