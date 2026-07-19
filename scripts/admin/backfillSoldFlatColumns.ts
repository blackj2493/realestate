/**
 * One-time backfill for migration 080: populate raw_vow_sold's flat sold-dynamics columns
 * (original_list_price, days_on_market, listing_contract_date) out of raw_payload, so
 * region_sold_dynamics reads them instead of detoasting the JSONB per row.
 *
 * Keyset-batched over listing_key (the PK) with a per-batch commit, so it never holds one
 * giant lock/transaction over the 281k-row table and survives interruption (re-run to
 * resume — it's a pure derive, idempotent). New rows are populated by the ingester.
 *
 * Run: npx tsx scripts/admin/backfillSoldFlatColumns.ts
 */
import "dotenv/config";
import { Client } from "pg";

const BATCH = 5000;

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout = '180s'");

  let last = ""; // keyset cursor over listing_key
  let done = 0;
  const t0 = Date.now();
  for (;;) {
    const { rows } = await c.query(
      `WITH batch AS (
         SELECT listing_key FROM raw_vow_sold WHERE listing_key > $1 ORDER BY listing_key LIMIT $2
       ),
       upd AS (
         UPDATE raw_vow_sold t SET
           original_list_price   = NULLIF(t.raw_payload->>'OriginalListPrice', '')::numeric,
           days_on_market        = NULLIF(t.raw_payload->>'DaysOnMarket', '')::numeric,
           listing_contract_date = CASE
             WHEN t.raw_payload->>'ListingContractDate' ~ '^\\d{4}-\\d{2}-\\d{2}'
             THEN left(t.raw_payload->>'ListingContractDate', 10)::date ELSE NULL END
         FROM batch WHERE t.listing_key = batch.listing_key
         RETURNING 1
       )
       SELECT (SELECT count(*) FROM upd)::int AS n, (SELECT max(listing_key) FROM batch) AS max_key`,
      [last, BATCH]
    );
    const n = rows[0].n as number;
    const maxKey = rows[0].max_key as string | null;
    if (!n || !maxKey) break;
    done += n;
    last = maxKey;
    if (done % 25000 < BATCH) console.log(`  ${done} rows (${Math.round((Date.now() - t0) / 1000)}s)…`);
    if (n < BATCH) break;
  }

  const { rows: chk } = await c.query(
    `SELECT count(*) FILTER (WHERE original_list_price IS NOT NULL) AS olp,
            count(*) FILTER (WHERE days_on_market IS NOT NULL) AS dom,
            count(*) FILTER (WHERE listing_contract_date IS NOT NULL) AS lcd,
            count(*) AS total FROM raw_vow_sold`
  );
  console.log(`done: ${done} rows updated in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log("populated:", chk[0]);
  await c.end();
}

main().catch((e) => { console.error("backfill failed:", e?.message || e); process.exit(1); });
