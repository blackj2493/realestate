/**
 * Populate rental_market_index from THREE populations, kept apart (133).
 *
 *   closed_12   signed leases from raw_vow_sold, closed in the last 12 months
 *   closed_24   the same over 24 months — INCLUSIVE of the 12, so it keeps a thin
 *               cohort alive rather than describing a different period
 *   asking      ACTIVE for-lease asks from listings (new / price change / extension)
 *
 * WHY THIS CHANGED. This script used to read ONE population — `listings.list_price` on
 * anything whose TransactionType looked like a lease — and call it the rent. Two faults
 * followed from that:
 *
 *   1. An ask is not a rent. It is what a landlord hopes to get. `raw_vow_sold` holds
 *      271,287 CLOSED lease records with the price a tenant actually signed, and this
 *      script read none of them. The header used to claim raw_vow_sold carried "~985
 *      stray leases"; it is out by a factor of 275.
 *   2. Of the 101,617 lease records it did read, 53,655 (53%) already carry
 *      standard_status 'leased'. Those are finished deals whose ask is stale by
 *      definition, and whose real close price sits in raw_vow_sold — so the old pass
 *      counted the same deal twice, at the wrong number, on the majority of its input.
 *      The asking pass is now restricted to OPEN statuses for exactly that reason.
 *
 * The two populations never pool into one median. They are also not systematically
 * apart — over 3,175 matched city_bath cohorts the median difference is 0.00% and the
 * mean -$51 — so an ask in the RIGHT cohort stays a legitimate same-rung fallback.
 *
 * Measured OUT OF TIME (index built only from closes older than 3 months, scored on
 * 40,408 closes from the last 3 months that the index could not have seen):
 *
 *   asking-only (the old ladder)   covered 95.6%   median err 6.52%   p90 20.7%
 *   closed_12 > closed_24 > ask    covered 98.7%   median err 5.53%   p90 18.1%
 *
 * Requires migration 133 (the `basis` column and the widened unique key).
 *
 * Usage:
 *   npx tsx scripts/admin/refreshRentalMarketIndex.ts --dry-run   (no writes; prints cohort stats)
 *   npx tsx scripts/admin/refreshRentalMarketIndex.ts --apply     (truncates + repopulates)
 */
import 'dotenv/config';
import { Client } from 'pg';
import {
  createRentAccumulator,
  CLOSED_WINDOW_MONTHS,
  type RentBasis,
  type RentalIndexRow,
} from '../worker/services/rentModel';

const WRITE_CHUNK = 500;
const APPLY = process.argv.includes('--apply');
const DRY = process.argv.includes('--dry-run') || !APPLY;

/**
 * Statuses whose list_price is still an OFFER on the market.
 *
 * 'leased' is deliberately absent. Those 53,655 records are closed deals; their real
 * price is in raw_vow_sold and reaches the index through the closed passes. Reading
 * their stale ask as well would count one deal twice at two different numbers.
 * 'deal fell through', 'terminated' and the conditional states are absent for the same
 * reason in reverse — nothing was agreed, so there is no market signal to bank.
 */
const OPEN_LEASE_STATUSES = ['new', 'price change', 'extension'] as const;

/** Shape both queries hand to the accumulator, so one mapper serves both. */
interface LeaseRow {
  list_price: number | string | null;
  close_price: number | string | null;
  city: string | null;
  city_region: string | null;
  property_sub_type: string | null;
  transaction_type: string | null;
  bedrooms_total: string | number | null;
  bedrooms_above: string | number | null;
  bedrooms_below: string | number | null;
  bathrooms_total: string | number | null;
  county: string | null;
  unparsed_address: string | null;
  dedupe_key: string | null;
}

/** Feed values arrive as text from full_payload and as int from the vault columns. */
const int = (v: string | number | null): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  return /^[0-9]+$/.test(v ?? '') ? parseInt(v as string, 10) : null;
};

function accumulate(rows: LeaseRow[], basis: RentBasis): RentalIndexRow[] {
  const acc = createRentAccumulator(basis);
  for (const r of rows) {
    acc.add({
      transactionType: r.transaction_type,
      closePrice: r.close_price != null ? Number(r.close_price) : null,
      listPrice: r.list_price != null ? Number(r.list_price) : null,
      city: r.city,
      cityRegion: r.city_region,
      propertySubType: r.property_sub_type,
      bedroomsTotal: int(r.bedrooms_total),
      // The feed OMITS BedroomsBelowGrade when it is zero (present on 23,356 of
      // 94,356 active leases, non-zero on 21,234 of those), so null here means "no
      // plus-room" rather than "unknown".
      bedroomsAboveGrade: int(r.bedrooms_above),
      bedroomsBelowGrade: int(r.bedrooms_below),
      // Real bath count — replaces the bogus WashroomsType1Pcs piece-count key.
      bathroomsTotal: int(r.bathrooms_total),
      // Parent geography for the `county` rung (124). 100% populated in the feed.
      county: r.county,
      // In-home unit tell (125). 12.0% of this inventory is a basement / upper /
      // main-floor unit wearing the whole house's sub-type. Without this column they
      // land in the whole-home cohorts and drag the medians that become cap_rate_est.
      unparsedAddress: r.unparsed_address,
      // Belt and braces with the DISTINCT ON in the SQL: the model enforces it too, so
      // a future caller that forgets the SQL cannot reintroduce duplicate comps.
      dedupeKey: r.dedupe_key,
    });
  }
  return acc.finalize();
}

/**
 * Signed leases from the vault.
 *
 * DISTINCT ON the property, newest close first: a home that leased in 2025 and again in
 * 2026 is ONE comp at its current rent, not two. Ordering by close_date DESC is what
 * makes the survivor the recent one.
 *
 * `close_date <= current_date` is not decoration — the feed carries at least one row
 * dated 5199-12-31, and without the guard it would sit inside every window forever.
 */
async function loadClosed(client: Client, months: number): Promise<LeaseRow[]> {
  const { rows } = await client.query<LeaseRow>(
    `SELECT DISTINCT ON (coalesce(nullif(property_hash,''), listing_key))
            list_price,
            close_price,
            city,
            city_region,
            btrim(property_sub_type)          AS property_sub_type,
            transaction_type,
            -- MUST be present. rentModel.add() returns early on a null bedroomsTotal,
            -- so leaving this NULL would silently empty BOTH closed passes and hand
            -- every listing back to the asking rung. The vault stores the two halves
            -- and no sum, unlike the live feed's BedroomsTotal.
            --
            -- NULL when the vault has NEITHER half, rather than a summed zero: a record
            -- with no bed data must be dropped, exactly as the asking pass drops one
            -- with no BedroomsTotal. Summing to 0 would instead invent a "0 bedroom"
            -- cohort and publish house rents under it.
            CASE WHEN bedrooms_above_grade IS NULL AND bedrooms_below_grade IS NULL
                 THEN NULL
                 ELSE coalesce(bedrooms_above_grade, 0) + coalesce(bedrooms_below_grade, 0)
            END                               AS bedrooms_total,
            bedrooms_above_grade              AS bedrooms_above,
            bedrooms_below_grade              AS bedrooms_below,
            bathrooms_total_integer           AS bathrooms_total,
            raw_payload->>'CountyOrParish'    AS county,
            unparsed_address,
            coalesce(nullif(property_hash,''), listing_key) AS dedupe_key
       FROM raw_vow_sold
      WHERE transaction_type ILIKE '%leas%'
        AND close_date <= current_date
        AND close_date >= current_date - ($1 || ' months')::interval
        AND coalesce(nullif(close_price, 0), list_price) IS NOT NULL
      ORDER BY coalesce(nullif(property_hash,''), listing_key), close_date DESC`,
    [String(months)],
  );
  return rows;
}

/**
 * Current asks, OPEN statuses only.
 *
 * ONE ROW PER PROPERTY, not per record. The feed carries the same rental more than
 * once — a relist, a corrected record, the same home filed under both "Toronto" and
 * "Toronto C07" — and every copy used to count as an independent comp. Measured
 * 2026-08-22: 5,284 of 91,159 lease records (5.8%) are duplicates, and 426 of the
 * 5,867 published neighbourhood cohorts existed ONLY because duplicates lifted them
 * over MIN_COHORT_SAMPLES.
 *
 * 262 Senlac Road is what that looked like on screen: its cohort held $23,000, $23,000
 * and $8,000, where the two $23,000 records are both 316 Churchill Avenue.
 *
 * NOTE last_seen_at is a CREATION timestamp here, not a heartbeat, so DESC keeps the
 * newest record for a property — the current asking rent.
 */
async function loadAsking(client: Client): Promise<LeaseRow[]> {
  const { rows } = await client.query<LeaseRow>(
    `SELECT DISTINCT ON (coalesce(nullif(property_hash,''), nullif(norm_address,''), listing_key))
            list_price,
            NULL::numeric                           AS close_price,
            city,
            city_region,
            property_sub_type,
            full_payload->>'TransactionType'        AS transaction_type,
            full_payload->>'BedroomsTotal'          AS bedrooms_total,
            full_payload->>'BedroomsAboveGrade'     AS bedrooms_above,
            full_payload->>'BedroomsBelowGrade'     AS bedrooms_below,
            full_payload->>'BathroomsTotalInteger'  AS bathrooms_total,
            full_payload->>'CountyOrParish'         AS county,
            full_payload->>'UnparsedAddress'        AS unparsed_address,
            coalesce(nullif(property_hash,''), nullif(norm_address,''), listing_key) AS dedupe_key
       FROM listings
      WHERE standard_status = ANY($1::text[])
        AND lower(coalesce(full_payload->>'TransactionType', '')) ~ '(leas|rent)'
      ORDER BY coalesce(nullif(property_hash,''), nullif(norm_address,''), listing_key),
               last_seen_at DESC NULLS LAST, listing_key DESC`,
    [OPEN_LEASE_STATUSES as unknown as string[]],
  );
  return rows;
}

function report(label: string, read: number, rows: RentalIndexRow[]): void {
  const split = rows.filter((r) => r.bedrooms_above !== null).length;
  console.log(`\n${label}: read ${read.toLocaleString()} record(s) -> ${rows.length.toLocaleString()} cohorts (min-N met).`);
  console.log(`  plus-room split: ${split.toLocaleString()}   merged fallback: ${(rows.length - split).toLocaleString()}`);
  // Per-rung counts: a rung that silently drops to zero is the failure mode here, and
  // it would only show up later as listings falling through to no estimate at all.
  const byTier = rows.reduce<Record<string, number>>((a, r) => {
    a[r.match_tier] = (a[r.match_tier] ?? 0) + 1;
    return a;
  }, {});
  for (const t of ['nbhd', 'city_bath', 'city', 'city_family', 'county', 'suite_nbhd', 'suite_city'] as const) {
    console.log(`  ${t.padEnd(12)} ${(byTier[t] ?? 0).toLocaleString().padStart(7)} cohorts`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL (Session pooler) is required — see CLAUDE.md §12.');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  // REFUSE TO RUN AGAINST A PRE-133 TABLE. Without the basis column the three passes
  // would collide on the widened key and the insert would die part-way through, after
  // the TRUNCATE — leaving the ladder with whatever fraction had landed.
  const { rows: hasBasis } = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM information_schema.columns
      WHERE table_name = 'rental_market_index' AND column_name = 'basis'`,
  );
  if (Number(hasBasis[0]?.n ?? 0) === 0) {
    throw new Error('rental_market_index has no `basis` column — apply migration 133 first.');
  }

  const passes: Array<{ basis: RentBasis; label: string; read: number; rows: RentalIndexRow[] }> = [];

  for (const basis of ['closed_12', 'closed_24'] as const) {
    const raw = await loadClosed(client, CLOSED_WINDOW_MONTHS[basis]);
    const rows = accumulate(raw, basis);
    report(`${basis} (signed leases, ${CLOSED_WINDOW_MONTHS[basis]} months)`, raw.length, rows);
    passes.push({ basis, label: basis, read: raw.length, rows });
  }

  const askRaw = await loadAsking(client);
  const askRows = accumulate(askRaw, 'asking');
  report('asking (active for-lease asks)', askRaw.length, askRows);
  passes.push({ basis: 'asking', label: 'asking', read: askRaw.length, rows: askRows });

  const indexRows = passes.flatMap((p) => p.rows);

  // GUARDS. Each one caught a real way this table has broken before, and each fails the
  // run rather than publishing a partial index.
  const splitRows = indexRows.filter((r) => r.bedrooms_above !== null).length;
  if (splitRows === 0) {
    throw new Error(
      'No plus-room cohorts survived — BedroomsAboveGrade/BelowGrade are probably absent ' +
      'from the payloads. Refusing to publish a merged-only index (see migration 122).',
    );
  }
  for (const p of passes) {
    if (p.rows.length === 0) {
      throw new Error(
        `The ${p.label} pass produced ZERO cohorts from ${p.read} record(s). A basis that ` +
        'silently empties is invisible downstream — every listing just quietly drops a ' +
        'rung. Refusing to publish.',
      );
    }
  }

  console.log(`\nTOTAL ${indexRows.length.toLocaleString()} cohort rows across ${passes.length} bases.`);
  console.log('Sample:', indexRows.slice(0, 3));

  if (DRY) {
    console.log('\nDRY RUN — no writes. Re-run with --apply to populate rental_market_index.');
    await client.end();
    return;
  }

  await client.query('TRUNCATE rental_market_index');
  for (let i = 0; i < indexRows.length; i += WRITE_CHUNK) {
    const batch = indexRows.slice(i, i + WRITE_CHUNK);
    const COLS = 14; // keep in lockstep with the INSERT column list + params.push below
    const params: (string | number | null)[] = [];
    const tuples = batch.map((row, j) => {
      const b = j * COLS;
      params.push(row.match_tier, row.basis, row.city_region, row.city, row.property_sub_type,
        row.bedrooms_total, row.bedrooms_above, row.den, row.bathrooms,
        row.avg_rent, row.p10_rent, row.sample_count,
        row.county, row.sub_type_family);
      return `(${Array.from({ length: COLS }, (_, k) => `$${b + k + 1}`).join(', ')})`;
    });
    await client.query(
      `INSERT INTO rental_market_index
         (match_tier, basis, city_region, city, property_sub_type, bedrooms_total,
          bedrooms_above, den, bathrooms, avg_rent, p10_rent, sample_count,
          county, sub_type_family)
       VALUES ${tuples.join(',')}`,
      params,
    );
  }
  console.log(`Upserted ${indexRows.length.toLocaleString()} tiered cohorts into rental_market_index.`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
