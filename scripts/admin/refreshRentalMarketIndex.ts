/**
 * Populate rental_market_index from the ACTIVE for-lease inventory (current asking rents).
 * Source: listings WHERE TransactionType ~ lease — list_price is the monthly rent there
 * (there is no close_price; the listing isn't closed). The active for-lease set (~38k) is
 * the real rent-comp source; raw_vow_sold (the SOLD feed) carries only ~985 stray leases.
 * The pure helpers in worker/services/rentModel.ts emit 3 fallback tiers per lease —
 * neighbourhood+baths, city+baths, city (baths relaxed) — keyed on REAL bath count.
 *
 * Usage:
 *   npx tsx scripts/admin/refreshRentalMarketIndex.ts --dry-run   (no writes; prints cohort stats)
 *   npx tsx scripts/admin/refreshRentalMarketIndex.ts --apply     (truncates + repopulates)
 */
import 'dotenv/config';
import { Client } from 'pg';
import { createRentAccumulator, type RentalIndexRow } from '../worker/services/rentModel';

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

  // One filtered pass over the active for-lease inventory (asking rents).
  // city is a scalar column; TransactionType/beds/baths live in full_payload.
  const { rows } = await client.query(
    `SELECT list_price,
            city,
            city_region,
            property_sub_type,
            full_payload->>'TransactionType'        AS transaction_type,
            full_payload->>'BedroomsTotal'          AS bedrooms_total,
            full_payload->>'BedroomsAboveGrade'     AS bedrooms_above,
            full_payload->>'BedroomsBelowGrade'     AS bedrooms_below,
            full_payload->>'BathroomsTotalInteger'  AS bathrooms_total
       FROM listings
      WHERE lower(coalesce(full_payload->>'TransactionType', '')) ~ '(leas|rent)'`,
  );
  for (const r of rows) {
    acc.add({
      transactionType: r.transaction_type,
      closePrice: null,
      listPrice: r.list_price != null ? Number(r.list_price) : null,
      city: r.city,
      cityRegion: r.city_region,
      propertySubType: r.property_sub_type,
      bedroomsTotal: r.bedrooms_total != null ? parseInt(r.bedrooms_total, 10) : null,
      // The feed OMITS BedroomsBelowGrade when it is zero (present on 23,356 of
      // 94,356 active leases, non-zero on 21,234 of those), so null here means "no
      // plus-room" rather than "unknown".
      bedroomsAboveGrade: /^[0-9]+$/.test(r.bedrooms_above ?? '') ? parseInt(r.bedrooms_above, 10) : null,
      bedroomsBelowGrade: /^[0-9]+$/.test(r.bedrooms_below ?? '') ? parseInt(r.bedrooms_below, 10) : null,
      // Real bath count — replaces the bogus WashroomsType1Pcs piece-count key.
      bathroomsTotal: /^[0-9]+$/.test(r.bathrooms_total ?? '') ? parseInt(r.bathrooms_total, 10) : null,
    });
  }

  const indexRows: RentalIndexRow[] = acc.finalize();
  const splitRows = indexRows.filter((r) => r.bedrooms_above !== null).length;
  console.log(`Read ${rows.length} active for-lease listings -> ${indexRows.length} cohorts (min-N met).`);
  console.log(`  plus-room split cohorts: ${splitRows}   merged fallback cohorts: ${indexRows.length - splitRows}`);
  if (splitRows === 0) {
    throw new Error(
      'No plus-room cohorts survived — BedroomsAboveGrade/BelowGrade are probably absent ' +
      'from full_payload. Refusing to publish a merged-only index (see migration 122).',
    );
  }
  console.log('Sample:', indexRows.slice(0, 5));

  if (DRY) {
    console.log('DRY RUN — no writes. Re-run with --apply to populate rental_market_index.');
    await client.end();
    return;
  }

  await client.query('TRUNCATE rental_market_index');
  for (let i = 0; i < indexRows.length; i += WRITE_CHUNK) {
    const batch = indexRows.slice(i, i + WRITE_CHUNK);
    const COLS = 11;
    const params: (string | number | null)[] = [];
    const tuples = batch.map((row, j) => {
      const b = j * COLS;
      params.push(row.match_tier, row.city_region, row.city, row.property_sub_type,
        row.bedrooms_total, row.bedrooms_above, row.den, row.bathrooms,
        row.avg_rent, row.p10_rent, row.sample_count);
      return `(${Array.from({ length: COLS }, (_, k) => `$${b + k + 1}`).join(', ')})`;
    });
    await client.query(
      `INSERT INTO rental_market_index
         (match_tier, city_region, city, property_sub_type, bedrooms_total,
          bedrooms_above, den, bathrooms, avg_rent, p10_rent, sample_count)
       VALUES ${tuples.join(',')}`,
      params,
    );
  }
  console.log(`Upserted ${indexRows.length} tiered cohorts into rental_market_index.`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
