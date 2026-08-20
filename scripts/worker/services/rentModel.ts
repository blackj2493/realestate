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

export const MIN_MONTHLY_RENT = 500;
export const MAX_MONTHLY_RENT = 25000;
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

export type MatchTier = 'nbhd' | 'city_bath' | 'city';

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

export interface RentalIndexRow {
  match_tier: MatchTier;
  city_region: string | null;
  city: string | null;
  property_sub_type: string;
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

type RowMeta = Omit<RentalIndexRow, 'avg_rent' | 'p10_rent' | 'sample_count'>;

export function createRentAccumulator() {
  const groups = new Map<string, { meta: RowMeta; rents: number[] }>();
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
      const cr = (r.cityRegion ?? '').trim();
      const city = (r.city ?? '').trim();
      // btrim: the feed ships "Semi-Detached " with a trailing space, which would
      // otherwise fragment every cohort for that sub-type into two.
      const st = (r.propertySubType ?? '').trim();
      const beds = r.bedroomsTotal;
      const bath = r.bathroomsTotal;
      if (!st || beds == null) return;

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
        const meta = { property_sub_type: st, bedrooms_total: beds, bedrooms_above: d.above, den: d.den };
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
        // Tier 3 — city, baths relaxed (last resort)
        if (city) {
          bump(`c|${city.toLowerCase()}|${st.toLowerCase()}|${d.tag}`,
            { match_tier: 'city', city_region: null, city, ...meta, bathrooms: null }, rent);
        }
      }
    },
    finalize(): RentalIndexRow[] {
      const rows: RentalIndexRow[] = [];
      for (const g of groups.values()) {
        if (g.rents.length < MIN_COHORT_SAMPLES) continue;
        const sorted = [...g.rents].sort((a, b) => a - b);
        rows.push({ ...g.meta, avg_rent: Math.round(percentile(sorted, 0.5)), p10_rent: Math.round(percentile(sorted, 0.10)), sample_count: sorted.length });
      }
      return rows;
    },
  };
}

export function buildRentalIndexRows(records: RawLeaseInput[]): RentalIndexRow[] {
  const acc = createRentAccumulator();
  for (const r of records) acc.add(r);
  return acc.finalize();
}
