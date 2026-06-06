/**
 * Rent-model aggregation helpers (pure, no I/O).
 * Source: leased rows in raw_vow_sold (sold + leased are mixed; a lease carries
 * its monthly rent in close_price/list_price, NOT a sale price). We compute
 * median + p10 monthly rent per cohort for rental_market_index (migration 006).
 */

export const MIN_MONTHLY_RENT = 500;
export const MAX_MONTHLY_RENT = 25000;
export const MIN_COHORT_SAMPLES = 5; // suppress thin cohorts (noise + min-N hygiene)

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
      const st = (r.propertySubType ?? '').trim();
      const beds = r.bedroomsTotal;
      const bath = r.bathroomsTotal;
      if (!st || beds == null) return;

      // Tier 1 — neighbourhood + baths (most precise)
      if (cr && bath != null) {
        bump(`nbhd|${cr.toLowerCase()}|${st.toLowerCase()}|${beds}|${bath}`,
          { match_tier: 'nbhd', city_region: cr, city: city || null, property_sub_type: st, bedrooms_total: beds, bathrooms: bath }, rent);
      }
      // Tier 2 — city + baths
      if (city && bath != null) {
        bump(`cb|${city.toLowerCase()}|${st.toLowerCase()}|${beds}|${bath}`,
          { match_tier: 'city_bath', city_region: null, city, property_sub_type: st, bedrooms_total: beds, bathrooms: bath }, rent);
      }
      // Tier 3 — city, baths relaxed (last resort)
      if (city) {
        bump(`c|${city.toLowerCase()}|${st.toLowerCase()}|${beds}`,
          { match_tier: 'city', city_region: null, city, property_sub_type: st, bedrooms_total: beds, bathrooms: null }, rent);
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
