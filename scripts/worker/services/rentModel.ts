/**
 * Rent-model aggregation helpers (pure, no I/O).
 * Source: leased rows in raw_vow_sold (sold + leased are mixed; a lease carries
 * its monthly rent in close_price/list_price, NOT a sale price). We compute
 * median + p10 monthly rent per cohort for rental_market_index (migrations 006/030/122).
 *
 * Cohorts are keyed TWICE since 122 — once on the plus-room split (a 1+den is not a
 * 2 bedroom; backtested at 6.67% median error vs 7.69% merged over 56,228 leases)
 * and once on the old merged total, which survives purely as the coverage fallback.
 */
import { bedSplit } from '@/lib/listings/bedSplit';
import { subTypeFamily } from '@/lib/listings/subTypeFamily';
import { isPartialUnitRental } from '@/lib/listings/inHomeUnit';
import { MONTHLY_RENT_BAND } from '@/lib/metrics/sanityBand';

// One definition, shared with the web side. It used to live only here, which is why
// the address page's "Median rent" tile had no ceiling and published $120,300/mo.
export const MIN_MONTHLY_RENT = MONTHLY_RENT_BAND.min;
export const MAX_MONTHLY_RENT = MONTHLY_RENT_BAND.max;
/**
 * Minimum leases a cohort needs before it publishes a rent.
 *
 * Lowered 5 -> 3 on measured evidence. Leave-one-out backtest over 84,496 active
 * leases, predicting each one from its own lookup ladder with itself removed:
 *
 *   floor | cohorts | active for-sale covered | median err | err of the cohorts ADDED
 *     5   |  14,782 |   76,866  (61.5%)       |   6.06%    |  —
 *     4   |  18,459 |   79,354  (63.5%)       |   6.06%    |  median 7.69%, p90 29.3%
 *     3   |  24,769 |   82,461  (66.0%)       |   6.06%    |  median 8.17%, p90 30.9%
 *     2   |  37,240 |   86,963  (69.6%)       |   6.00%    |  median 8.00%, p90 33.4%
 *
 * 3 buys 5,595 more covered listings for ~2 points of median error on the newly
 * covered ones, and the blended median does not move. It is also the smallest
 * honest median: at n=2 the "median" is the mean of two, so one outlier moves it
 * 50%, and at n=1 the leave-one-out set is empty — the estimate would be the
 * listing's own asking rent, which is circular, not a comp. Do not go below 3.
 *
 * Every consumer must still pass the value through CAP_RATE_BAND / GROSS_YIELD_BAND
 * (src/lib/metrics/sanityBand.ts), which is what catches the widened p90 tail.
 */
export const MIN_COHORT_SAMPLES = 3;

/**
 * Lookup rungs, MOST PRECISE FIRST. The order is the accuracy order measured by
 * leave-one-out over the lease book, and the lookup walks it top to bottom:
 *
 *   nbhd        5.56%   city_bath  8.22%   city  13.73%
 *   city_family 13.17%  county    14.49%                (migration 124)
 *
 * `city_family` sits above `county` because location dominates rent: relaxing the
 * sub-type inside the right city beats keeping the sub-type two counties away.
 */
export type MatchTier = 'nbhd' | 'city_bath' | 'city' | 'city_family' | 'county';

/**
 * Suite rungs (125). Kept OUT of MatchTier deliberately: MatchTier is walked in order
 * by fetchRentAVM and published as listings.rent_match_tier, and a suite rent must
 * never surface as a whole-home comp. Separate type, separate walk, separate column.
 */
export type SuiteMatchTier = 'suite_nbhd' | 'suite_city';

/** Family marker on suite rows, where property_sub_type is NULL. */
export const IN_HOME_UNIT_FAMILY = 'in_home_unit';

/** Suite bed columns collapse above this. A 4-bedroom basement is vanishingly rare,
 *  and pooling it with 3 keeps the cohort honest rather than empty. */
export const SUITE_BED_CAP = 3;

export interface RawLeaseInput {
  status?: string | null;
  transactionType?: string | null;
  closePrice?: number | null;
  listPrice?: number | null;
  city?: string | null;
  cityRegion?: string | null;
  propertySubType?: string | null;
  bedroomsTotal?: number | null;
  /** BedroomsAboveGrade. Absent/0 is recovered from the total — see bedSplit. */
  bedroomsAboveGrade?: number | null;
  /** BedroomsBelowGrade. The feed OMITS this when it is zero (measured: present on
   *  23,356 of 94,356 active leases, and non-zero on 21,234 of those), so an absent
   *  value means "no plus-room", not "unknown". */
  bedroomsBelowGrade?: number | null;
  bathroomsTotal?: number | null; // real bath count (BathroomsTotalInteger)
  /** CountyOrParish — the parent geography for the `county` rung (migration 124). */
  county?: string | null;
  /**
   * Stable identity for the PROPERTY, not the record —
   * coalesce(property_hash, norm_address, listing_key), the same key
   * region_active_aggregates uses. The feed carries the same rental more than once
   * (a relist, a corrected record, the same home under both "Toronto" and
   * "Toronto C07") and each copy used to count as an independent comp.
   *
   * Measured 2026-08-22: 5,284 of 91,159 lease records are duplicates, and 426 of
   * 5,867 published neighbourhood cohorts existed ONLY because duplicates lifted them
   * over MIN_COHORT_SAMPLES. 262 Senlac Road published $23,008/mo from a cohort of
   * [$23,000, $23,000, $8,000] where the two $23,000 records are the same house.
   *
   * The caller's SQL already dedupes; this is the guard that makes the rule belong to
   * the model rather than to one query. Omit it and nothing is deduped, which is the
   * pre-fix behaviour.
   */
  dedupeKey?: string | null;
  /** UnparsedAddress. THE contamination guard (125): 12.0% of the active for-lease
   *  book is an in-home unit — a basement or upper unit listed under the whole
   *  house's sub-type. Without this the lease lands in the Detached 3bd cohort and
   *  drags a published median down by as much as 72%. Omit it and every lease is
   *  treated as a whole home, which is exactly the pre-125 behaviour. */
  unparsedAddress?: string | null;
}

const LEASE_STATUS = new Set(['leased', 'lease', 'for lease', 'rented', 'rental']);

export function isLeaseRecord(r: RawLeaseInput): boolean {
  const s = (r.status ?? '').trim().toLowerCase();
  const t = (r.transactionType ?? '').trim().toLowerCase();
  if (LEASE_STATUS.has(s)) return true;
  return t.includes('lease') || t.includes('rent');
}

export function extractMonthlyRent(r: RawLeaseInput): number | null {
  const raw = r.closePrice && r.closePrice > 0 ? r.closePrice : (r.listPrice ?? 0);
  if (!raw || raw < MIN_MONTHLY_RENT || raw > MAX_MONTHLY_RENT) return null;
  return Math.round(raw);
}

/** Linear-interpolated percentile over an ASCENDING-sorted array. p in [0,1]. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/**
 * WHERE A COHORT'S RENT CAME FROM (133).
 *
 * Until this, every published cohort was an ASKING rent — `listings.list_price` on a
 * for-lease record, which is what a landlord hopes to get, not what a tenant signed.
 * The signed price was sitting unused the whole time: `raw_vow_sold` holds 271,287
 * closed lease records, 234,100 of them inside 24 months and past the price band and
 * the in-home-unit filter. The ETL read none of them — and it read 53,655 records that
 * are ALREADY `leased` as though their now-stale ask were still the market.
 *
 * The two populations must never pool into one median: an ask is an offer, a close is
 * a transaction. They are also not systematically apart — measured over 3,175 matched
 * `city_bath` cohorts the median difference is 0.00% and the mean -$51 — so an ask in
 * the RIGHT cohort is an honest comp, and the lookup keeps it as a same-rung fallback
 * rather than throwing away the coverage it buys.
 *
 * Measured OUT OF TIME (index built only from closes older than 3 months, scored
 * against 40,408 closes from the last 3 months, so the index cannot have seen them):
 *
 *   asking-only (the old ladder)   covered 95.6%   median err 6.52%   p90 20.7%
 *   closed_12 > closed_24 > ask    covered 98.7%   median err 5.53%   p90 18.1%
 *
 * Accuracy and coverage improve together, which is why this is not a trade-off.
 *
 * The type, the preference order and the picker themselves live in
 * `@/lib/metrics/rentTier` and are only re-exported here. They HAVE to sit on the web
 * side of the wall: the worker can import from `@/lib`, the web app cannot import from
 * `scripts/`, and four readers of rental_market_index span that wall. Restating the
 * ranking on both sides is exactly how the grid and the ladder disagreed for a year.
 */
// Imported for use in this file's own types AND re-exported, so worker callers can keep
// taking everything rent-model-shaped from one module.
import type { RentBasis } from '@/lib/metrics/rentTier';
export type { RentBasis };
export { RENT_BASIS_PREFERENCE, pickPreferredBasis } from '@/lib/metrics/rentTier';

/** `closed_24` is INCLUSIVE of `closed_12` — it is "the last 24 months", not "months
 *  13-24". The 12-month row is preferred where it clears the floor; the 24-month row
 *  exists to keep a thin cohort alive rather than to describe a different period. */
export const CLOSED_WINDOW_MONTHS: Readonly<Record<'closed_12' | 'closed_24', number>> = {
  closed_12: 12,
  closed_24: 24,
};

export interface RentalIndexRow {
  /** Whole-home rungs and suite rungs share the table but never the walk (125). */
  match_tier: MatchTier | SuiteMatchTier;
  /** Closed lease vs asking rent, and the window it was drawn over (133). */
  basis: RentBasis;
  city_region: string | null;
  city: string | null;
  /** CountyOrParish. Set only on `county` rows, where city is NULL. */
  county: string | null;
  /** NULL on rungs that pool sub-types, where sub_type_family carries the key instead. */
  property_sub_type: string | null;
  /** Pooled family: 'condo'|'freehold' on `city_family` rows, 'in_home_unit' on the
   *  two suite rungs. NULL on every rung that keys on an exact sub-type. */
  sub_type_family: string | null;
  bedrooms_total: number;
  /** Whole bedrooms above grade. NULL marks a MERGED cohort keyed on bedrooms_total. */
  bedrooms_above: number | null;
  /** Capped plus-room flag. NULL marks a merged cohort. */
  den: 0 | 1 | null;
  bathrooms: number | null;
  avg_rent: number;   // median monthly rent
  p10_rent: number;   // 10th-percentile monthly rent
  sample_count: number;
}

/** `basis` is a property of the whole PASS, not of an individual cohort, so it is
 *  stamped once in finalize() rather than carried on every group. */
type RowMeta = Omit<RentalIndexRow, 'avg_rent' | 'p10_rent' | 'sample_count' | 'basis'>;

/**
 * @param basis which population this accumulator is being fed. One accumulator per
 *   population — feeding closes and asks into the same one would pool an offer with a
 *   transaction inside a single median, which is the thing 133 exists to prevent.
 *   Defaults to 'asking' so every pre-133 caller keeps its exact behaviour.
 */
export function createRentAccumulator(basis: RentBasis = 'asking') {
  const groups = new Map<string, { meta: RowMeta; rents: number[] }>();
  /** Properties already counted, so a duplicate record cannot become a second comp. */
  const seen = new Set<string>();
  const bump = (key: string, meta: RowMeta, rent: number) => {
    let g = groups.get(key);
    if (!g) { g = { meta, rents: [] }; groups.set(key, g); }
    g.rents.push(rent);
  };
  return {
    add(r: RawLeaseInput): void {
      if (!isLeaseRecord(r)) return;
      const rent = extractMonthlyRent(r);
      if (rent == null) return;
      // ONE ROW PER PROPERTY. A cohort of three that is really two homes is not a
      // cohort of three, and MIN_COHORT_SAMPLES is the only thing standing between a
      // thin market and a published number.
      const dk = (r.dedupeKey ?? '').trim();
      if (dk) {
        if (seen.has(dk)) return;
        seen.add(dk);
      }
      const cr = (r.cityRegion ?? '').trim();
      const city = (r.city ?? '').trim();
      // btrim: the feed ships "Semi-Detached " with a trailing space, which would
      // otherwise fragment every cohort for that sub-type into two.
      const st = (r.propertySubType ?? '').trim();
      const cty = (r.county ?? '').trim();
      // null for land / commercial: those must never receive a pooled rent.
      const fam = subTypeFamily(st);
      const beds = r.bedroomsTotal;
      const bath = r.bathroomsTotal;
      if (!st || beds == null) return;

      // ── In-home units (125) ───────────────────────────────────────────────────
      // A basement / upper / main-floor unit is NOT a whole home. It carries the
      // house's sub-type in the feed, so before this it was banked into the Detached
      // 3bd cohort and pulled the published median down — 12.0% of the book, moving
      // 410 house cohorts by >=1% and the worst by 72%.
      //
      // It returns EARLY: the lease feeds the suite rungs and nothing else. The two
      // populations answer different questions and must never pool.
      if (isPartialUnitRental(r.unparsedAddress, st)) {
        const suiteBeds = Math.min(SUITE_BED_CAP, Math.max(0, beds));
        const suiteMeta = {
          property_sub_type: null,
          sub_type_family: IN_HOME_UNIT_FAMILY,
          county: null,
          bedrooms_total: suiteBeds,
          // A suite has no plus-room split and no reliable bath count of its own.
          bedrooms_above: null,
          den: null,
          bathrooms: null,
        };
        if (cr) {
          bump(`sn|${cr.toLowerCase()}|${suiteBeds}`,
            { match_tier: 'suite_nbhd', city_region: cr, city: city || null, ...suiteMeta }, rent);
        }
        if (city) {
          bump(`sc|${city.toLowerCase()}|${suiteBeds}`,
            { match_tier: 'suite_city', city_region: null, city, ...suiteMeta }, rent);
        }
        return;
      }

      const split = bedSplit({
        BedroomsAboveGrade: r.bedroomsAboveGrade,
        BedroomsBelowGrade: r.bedroomsBelowGrade,
        BedroomsTotal: beds,
      });

      // Every lease lands in BOTH keyings — the split cohort it belongs to, and the
      // merged cohort it has always fed. The lookup prefers the split row; the merged
      // row is what keeps a listing from going null when its split cohort is too thin
      // (measured: split-only costs 1,830 of 76,869 covered listings).
      const dims: Array<{ above: number | null; den: 0 | 1 | null; tag: string }> = [
        { above: null, den: null, tag: `t${beds}` },
      ];
      if (split) dims.push({ above: split.above, den: split.den, tag: `s${split.above}_${split.den}` });

      for (const d of dims) {
        const meta = {
          property_sub_type: st, sub_type_family: null, county: null,
          bedrooms_total: beds, bedrooms_above: d.above, den: d.den,
        };
        // Tier 1 — neighbourhood + baths (most precise)
        if (cr && bath != null) {
          bump(`nbhd|${cr.toLowerCase()}|${st.toLowerCase()}|${d.tag}|${bath}`,
            { match_tier: 'nbhd', city_region: cr, city: city || null, ...meta, bathrooms: bath }, rent);
        }
        // Tier 2 — city + baths
        if (city && bath != null) {
          bump(`cb|${city.toLowerCase()}|${st.toLowerCase()}|${d.tag}|${bath}`,
            { match_tier: 'city_bath', city_region: null, city, ...meta, bathrooms: bath }, rent);
        }
        // Tier 3 — city, baths relaxed
        if (city) {
          bump(`c|${city.toLowerCase()}|${st.toLowerCase()}|${d.tag}`,
            { match_tier: 'city', city_region: null, city, ...meta, bathrooms: null }, rent);
        }
        // Tier 4 (124) — city held, sub-type relaxed to its family. Skipped entirely
        // for land / commercial, so a vacant lot can never inherit a house's rent.
        if (city && fam) {
          bump(`cf|${city.toLowerCase()}|${fam}|${d.tag}`,
            { match_tier: 'city_family', city_region: null, city, ...meta,
              property_sub_type: null, sub_type_family: fam, bathrooms: null }, rent);
        }
        // Tier 5 (124) — exact sub-type held, geography widened to the county.
        if (cty) {
          bump(`y|${cty.toLowerCase()}|${st.toLowerCase()}|${d.tag}`,
            { match_tier: 'county', city_region: null, city: null, ...meta,
              county: cty, bathrooms: null }, rent);
        }
      }
    },
    finalize(): RentalIndexRow[] {
      const rows: RentalIndexRow[] = [];
      for (const g of groups.values()) {
        if (g.rents.length < MIN_COHORT_SAMPLES) continue;
        const sorted = [...g.rents].sort((a, b) => a - b);
        rows.push({ ...g.meta, basis, avg_rent: Math.round(percentile(sorted, 0.5)), p10_rent: Math.round(percentile(sorted, 0.10)), sample_count: sorted.length });
      }
      return rows;
    },
  };
}

export function buildRentalIndexRows(records: RawLeaseInput[], basis: RentBasis = 'asking'): RentalIndexRow[] {
  const acc = createRentAccumulator(basis);
  for (const r of records) acc.add(r);
  return acc.finalize();
}
