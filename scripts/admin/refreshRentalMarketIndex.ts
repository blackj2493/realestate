/**
 * Populate rental_market_index from leased rows in raw_vow_sold.
 * Mirrors scripts/admin/backfill020.ts: direct pg Session-pooler client,
 * statement_timeout=0, keyset pagination by id, batched upserts.
 *
 * Usage:
 *   npx tsx scripts/admin/refreshRentalMarketIndex.ts --dry-run   (no writes; prints cohort stats)
 *   npx tsx scripts/admin/refreshRentalMarketIndex.ts --apply     (truncates + repopulates)
 */
import 'dotenv/config';
import { Client } from 'pg';
import { createRentAccumulator, type RentalIndexRow } from '../worker/services/rentModel';

const READ_CHUNK = 2000;
const WRITE_CHUNK = 500;
const APPLY = process.argv.includes('--apply');
const DRY = process.argv.includes('--dry-run') || !APPLY;

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL (Session pooler) is required — see CLAUDE.md §12.');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  const acc = createRentAccumulator();
  let lastKey = ''; // raw_vow_sold PK is listing_key (varchar); '' sorts before all keys
  let scanned = 0;

  for (;;) {
    const { rows } = await client.query(
      `SELECT listing_key,
              city_region,
              property_sub_type,
              close_price,
              list_price,
              raw_payload->>'Status'            AS status,
              raw_payload->>'MlsStatus'          AS mls_status,
              raw_payload->>'StandardStatus'     AS standard_status,
              raw_payload->>'TransactionType'    AS transaction_type,
              raw_payload->>'BedroomsTotal'      AS bedrooms_total,
              raw_payload->>'WashroomsType1Pcs'  AS washrooms_full
         FROM raw_vow_sold
        WHERE listing_key > $1
        ORDER BY listing_key
        LIMIT $2`,
      [lastKey, READ_CHUNK],
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      acc.add({
        status: r.status || r.mls_status || r.standard_status,
        transactionType: r.transaction_type,
        closePrice: r.close_price != null ? Number(r.close_price) : null,
        listPrice: r.list_price != null ? Number(r.list_price) : null,
        cityRegion: r.city_region,
        propertySubType: r.property_sub_type,
        bedroomsTotal: r.bedrooms_total != null ? parseInt(r.bedrooms_total, 10) : null,
        // rentAVM.ts looks up washrooms_full from raw.WashroomsType1Pcs with a `|| 1` default — match it.
        washroomsFull: r.washrooms_full != null ? parseInt(r.washrooms_full, 10) : 1,
      });
    }
    scanned += rows.length;
    lastKey = rows[rows.length - 1].listing_key;
    if (scanned % 50000 === 0) console.log(`   …scanned ${scanned} rows`);
  }

  const indexRows: RentalIndexRow[] = acc.finalize();
  console.log(`Scanned ${scanned} raw rows -> ${indexRows.length} qualifying cohorts (min-N met).`);
  console.log('Sample:', indexRows.slice(0, 5));

  if (DRY) {
    console.log('DRY RUN — no writes. Re-run with --apply to populate rental_market_index.');
    await client.end();
    return;
  }

  await client.query('TRUNCATE rental_market_index');
  for (let i = 0; i < indexRows.length; i += WRITE_CHUNK) {
    const batch = indexRows.slice(i, i + WRITE_CHUNK);
    const params: (string | number)[] = [];
    const tuples = batch.map((row, j) => {
      const b = j * 6;
      params.push(row.city_region, row.property_sub_type, row.bedrooms_total, row.washrooms_full, row.avg_rent, row.p10_rent);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, ${row.sample_count})`;
    });
    await client.query(
      `INSERT INTO rental_market_index
         (city_region, property_sub_type, bedrooms_total, washrooms_full, avg_rent, p10_rent, sample_count)
       VALUES ${tuples.join(',')}
       ON CONFLICT (city_region, property_sub_type, bedrooms_total, washrooms_full)
       DO UPDATE SET avg_rent = EXCLUDED.avg_rent, p10_rent = EXCLUDED.p10_rent,
                     sample_count = EXCLUDED.sample_count, updated_at = NOW()`,
      params,
    );
  }
  console.log(`Upserted ${indexRows.length} cohorts into rental_market_index.`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
