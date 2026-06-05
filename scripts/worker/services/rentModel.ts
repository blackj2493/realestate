/**
 * Rent-model aggregation helpers (pure, no I/O).
 * Source: leased rows in raw_vow_sold (sold + leased are mixed; a lease carries
 * its monthly rent in close_price/list_price, NOT a sale price). We compute
 * median + p10 monthly rent per cohort for rental_market_index (migration 006).
 */

export const MIN_MONTHLY_RENT = 500;
export const MAX_MONTHLY_RENT = 25000;
export const MIN_COHORT_SAMPLES = 5; // suppress thin cohorts (noise + min-N hygiene)

export interface RawLeaseInput {
  status?: string | null;
  transactionType?: string | null;
  closePrice?: number | null;
  listPrice?: number | null;
  cityRegion?: string | null;
  propertySubType?: string | null;
  bedroomsTotal?: number | null;
  washroomsFull?: number | null;
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
