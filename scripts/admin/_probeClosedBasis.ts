/**
 * Read-only probe for 133: what the three basis passes actually produce, and what the
 * ladder would answer for a listing once they exist.
 *
 * It runs the SAME SQL and the SAME accumulator as refreshRentalMarketIndex, so it
 * measures the shipped code rather than a restatement of it — but it never writes, and
 * it does not need migration 133 applied. That ordering matters: the migration is the
 * irreversible step, and this is what tells you whether to take it.
 *
 *   npx tsx scripts/admin/_probeClosedBasis.ts
 *   npx tsx scripts/admin/_probeClosedBasis.ts N13718184   (also walk one listing)
 */
import 'dotenv/config';
import { Client } from 'pg';
import {
  createRentAccumulator,
  CLOSED_WINDOW_MONTHS,
  RENT_BASIS_PREFERENCE,
  MIN_COHORT_SAMPLES,
  type RentBasis,
  type RentalIndexRow,
} from '../worker/services/rentModel';
import { bedSplit } from '@/lib/listings/bedSplit';

const OPEN_LEASE_STATUSES = ['new', 'price change', 'extension'];

const CLOSED_SQL = `
  SELECT DISTINCT ON (coalesce(nullif(property_hash,''), listing_key))
         list_price, close_price, city, city_region,
         btrim(property_sub_type) AS property_sub_type, transaction_type,
         CASE WHEN bedrooms_above_grade IS NULL AND bedrooms_below_grade IS NULL THEN NULL
              ELSE coalesce(bedrooms_above_grade,0) + coalesce(bedrooms_below_grade,0) END AS bedrooms_total,
         bedrooms_above_grade AS bedrooms_above, bedrooms_below_grade AS bedrooms_below,
         bathrooms_total_integer AS bathrooms_total,
         raw_payload->>'CountyOrParish' AS county, unparsed_address,
         coalesce(nullif(property_hash,''), listing_key) AS dedupe_key
    FROM raw_vow_sold
   WHERE transaction_type ILIKE '%leas%'
     AND close_date <= current_date
     AND close_date >= current_date - ($1 || ' months')::interval
     AND coalesce(nullif(close_price, 0), list_price) IS NOT NULL
   ORDER BY coalesce(nullif(property_hash,''), listing_key), close_date DESC`;

const ASKING_SQL = `
  SELECT DISTINCT ON (coalesce(nullif(property_hash,''), nullif(norm_address,''), listing_key))
         list_price, NULL::numeric AS close_price, city, city_region, property_sub_type,
         full_payload->>'TransactionType'       AS transaction_type,
         full_payload->>'BedroomsTotal'         AS bedrooms_total,
         full_payload->>'BedroomsAboveGrade'    AS bedrooms_above,
         full_payload->>'BedroomsBelowGrade'    AS bedrooms_below,
         full_payload->>'BathroomsTotalInteger' AS bathrooms_total,
         full_payload->>'CountyOrParish'        AS county,
         full_payload->>'UnparsedAddress'       AS unparsed_address,
         coalesce(nullif(property_hash,''), nullif(norm_address,''), listing_key) AS dedupe_key
    FROM listings
   WHERE standard_status = ANY($1::text[])
     AND lower(coalesce(full_payload->>'TransactionType','')) ~ '(leas|rent)'
   ORDER BY coalesce(nullif(property_hash,''), nullif(norm_address,''), listing_key),
            last_seen_at DESC NULLS LAST, listing_key DESC`;

const int = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  return /^[0-9]+$/.test(String(v ?? '')) ? parseInt(String(v), 10) : null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function accumulate(rows: any[], basis: RentBasis): RentalIndexRow[] {
  const acc = createRentAccumulator(basis);
  for (const r of rows) {
    acc.add({
      transactionType: r.transaction_type,
      closePrice: r.close_price != null ? Number(r.close_price) : null,
      listPrice: r.list_price != null ? Number(r.list_price) : null,
      city: r.city, cityRegion: r.city_region, propertySubType: r.property_sub_type,
      bedroomsTotal: int(r.bedrooms_total),
      bedroomsAboveGrade: int(r.bedrooms_above),
      bedroomsBelowGrade: int(r.bedrooms_below),
      bathroomsTotal: int(r.bathrooms_total),
      county: r.county, unparsedAddress: r.unparsed_address, dedupeKey: r.dedupe_key,
    });
  }
  return acc.finalize();
}

/** Cohort key, mirroring the columns the lookup filters on at each rung. */
const keyOf = (r: RentalIndexRow) => [
  r.match_tier, r.city_region ?? '', r.city ?? '', r.county ?? '',
  r.property_sub_type ?? '', r.sub_type_family ?? '', r.bedrooms_total,
  r.bathrooms ?? -1, r.bedrooms_above ?? -1, r.den ?? -1,
].join('|');

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL is required.');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  const byBasis = new Map<RentBasis, RentalIndexRow[]>();
  for (const basis of ['closed_12', 'closed_24'] as const) {
    const { rows } = await client.query(CLOSED_SQL, [String(CLOSED_WINDOW_MONTHS[basis])]);
    const cohorts = accumulate(rows, basis);
    byBasis.set(basis, cohorts);
    console.log(`${basis.padEnd(10)} read ${rows.length.toLocaleString().padStart(8)} closed lease(s) -> ${cohorts.length.toLocaleString().padStart(7)} cohorts`);
  }
  const { rows: askRows } = await client.query(ASKING_SQL, [OPEN_LEASE_STATUSES]);
  const askCohorts = accumulate(askRows, 'asking');
  byBasis.set('asking', askCohorts);
  console.log(`asking     read ${askRows.length.toLocaleString().padStart(8)} open ask(s)     -> ${askCohorts.length.toLocaleString().padStart(7)} cohorts`);

  // How many cohort keys each basis is the WINNER for — i.e. what the ladder will
  // actually serve. A basis with many cohorts but no wins is dead weight.
  const winner = new Map<string, RentBasis>();
  for (const basis of [...RENT_BASIS_PREFERENCE].reverse()) {
    for (const r of byBasis.get(basis) ?? []) winner.set(keyOf(r), basis);
  }
  const wins = new Map<RentBasis, number>();
  for (const b of winner.values()) wins.set(b, (wins.get(b) ?? 0) + 1);
  console.log(`\nDistinct cohort keys: ${winner.size.toLocaleString()}   (rows written: ${[...byBasis.values()].reduce((a, r) => a + r.length, 0).toLocaleString()})`);
  for (const b of RENT_BASIS_PREFERENCE) {
    const n = wins.get(b) ?? 0;
    console.log(`  ${b.padEnd(10)} wins ${n.toLocaleString().padStart(7)} key(s)  (${(100 * n / winner.size).toFixed(1)}%)`);
  }

  const key = process.argv[2];
  if (key) {
    const { rows } = await client.query(
      `SELECT listing_key, city, city_region, property_sub_type, list_price,
              full_payload->>'BedroomsAboveGrade' ab, full_payload->>'BedroomsBelowGrade' bl,
              full_payload->>'BedroomsTotal' bt, bathrooms_total_integer bath
         FROM listings WHERE listing_key = $1`, [key]);
    const s = rows[0];
    if (!s) { console.log(`\n${key}: no such listing.`); await client.end(); return; }
    const split = bedSplit({ BedroomsAboveGrade: int(s.ab), BedroomsBelowGrade: int(s.bl), BedroomsTotal: int(s.bt) });
    // COERCE. `bathrooms_total_integer` is numeric, and node-postgres hands numeric back
    // as a STRING to keep the precision it cannot fit in a double. `'5' === 5` is false,
    // so comparing it raw silently hides every bath-keyed rung — which is exactly what
    // this probe did on its first run, and why it appeared the closed passes had no
    // nbhd/city_bath cohorts at all when they had eleven comps sitting right there.
    const sBath = int(s.bath);
    console.log(`\n${key} — ${s.city_region} / ${s.city} / ${s.property_sub_type} / ${split?.above}+${split?.den} / ${sBath} bath`);
    const rungs = ['nbhd', 'city_bath', 'city', 'city_family', 'county'] as const;
    for (const basis of RENT_BASIS_PREFERENCE) {
      for (const tier of rungs) {
        const hit = (byBasis.get(basis) ?? []).find((r) =>
          r.match_tier === tier && r.bedrooms_above === split?.above && r.den === split?.den &&
          (tier === 'nbhd' ? r.city_region === s.city_region : true) &&
          (tier === 'city_bath' || tier === 'city' || tier === 'city_family' ? r.city === s.city : true) &&
          (tier === 'nbhd' || tier === 'city_bath' ? r.bathrooms === sBath : true) &&
          (tier === 'city_family' ? true : r.property_sub_type === s.property_sub_type));
        if (hit) console.log(`  ${basis.padEnd(10)} ${tier.padEnd(12)} $${hit.avg_rent}/mo  n=${hit.sample_count}`);
      }
    }
    console.log(`  (floor is n>=${MIN_COHORT_SAMPLES}; the ladder takes the FIRST line above, reading basis-major)`);
  }
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
