// scripts/admin/backfillFlatStatusEntry.ts
/**
 * One-time backfill of listings.original_entry_timestamp + standard_status from
 * full_payload (migration 067). Detoast-heavy (~14ms/row), so run in GENTLE batches
 * with pauses to keep Disk-IO low (avoids the Supabase Disk-IO alerts the geo-enrich
 * sweep tripped). Idempotent + resumable: batch selection keys on `standard_status IS
 * NULL`, and the UPDATE always sets standard_status to a non-null value (coalesce → '' at
 * worst), so every processed row leaves the null set and the loop terminates.
 * original_entry_timestamp may stay NULL for a bad/absent timestamp — the RPC COALESCEs
 * to full_payload for those rare rows.
 *
 * Run: npx tsx scripts/admin/backfillFlatStatusEntry.ts
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

const BATCH = 2500;
const PAUSE_MS = 200;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const UPDATE_SQL = `
  WITH batch AS (
    SELECT listing_key FROM listings WHERE standard_status IS NULL LIMIT ${BATCH}
  )
  UPDATE listings l
  SET original_entry_timestamp = CASE
        WHEN l.full_payload->>'OriginalEntryTimestamp' ~ '^\\d{4}-\\d{2}-\\d{2}'
        THEN (l.full_payload->>'OriginalEntryTimestamp')::timestamptz ELSE NULL END,
      standard_status = lower(coalesce(
        l.full_payload->>'Status', l.full_payload->>'MlsStatus', l.full_payload->>'StandardStatus', ''))
  FROM batch b
  WHERE l.listing_key = b.listing_key`;

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('✅ connected — backfilling listings.standard_status + original_entry_timestamp');

  const { rows: [{ total, todo }] } = await client.query(
    `SELECT count(*)::int total, count(*) FILTER (WHERE standard_status IS NULL)::int todo FROM listings`);
  console.log(`   rows: ${total} total, ${todo} to backfill (batch ${BATCH}, pause ${PAUSE_MS}ms)`);

  const t0 = Date.now();
  let done = 0, batches = 0;
  for (;;) {
    await client.query(`SET statement_timeout = '120s'`);
    const t = Date.now();
    const res = await client.query(UPDATE_SQL);
    const n = res.rowCount ?? 0;
    if (n === 0) break;
    done += n; batches++;
    const rate = done / ((Date.now() - t0) / 1000);
    console.log(`   batch ${batches}: +${n} (${((Date.now() - t) / 1000).toFixed(1)}s) · ${done}/${todo} · ${rate.toFixed(0)} rows/s`);
    await sleep(PAUSE_MS);
  }

  const { rows: [chk] } = await client.query(
    `SELECT count(*) FILTER (WHERE standard_status IS NULL)::int still_null,
            count(*) FILTER (WHERE original_entry_timestamp IS NULL)::int oet_null,
            count(*)::int n FROM listings`);
  console.log(`\n✅ done in ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min · ${done} rows updated`);
  console.log(`   verify: standard_status NULL=${chk.still_null} · original_entry_timestamp NULL=${chk.oet_null} / ${chk.n}`);
  await client.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
