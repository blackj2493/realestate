/**
 * Ontario new-home HST relief (agreements signed 2026-04-01 to 2027-03-31, primary
 * residence, bought from the builder). The page shows an ESTIMATE, not tax advice: the
 * federal part has its own rules, and the buyer's lawyer confirms the real amount.
 *
 *   price ≤ $1,000,000            → the full 13% HST (up to $130,000)
 *   $1,000,000 < price ≤ $1.5M    → $130,000
 *   $1.5M < price < $1.85M        → falls in a straight line from $130,000 to $24,000
 *   price ≥ $1,850,000            → $24,000 (the old rebate)
 */

export const HST_RATE = 0.13;
export const FULL_RELIEF_CAP = 1_000_000;
export const FLAT_RELIEF = 130_000;
export const FLAT_UNTIL = 1_500_000;
export const PHASE_OUT_END = 1_850_000;
export const OLD_REBATE = 24_000;

export type ReliefBand = "under_1m" | "1m_1_5m" | "1_5m_1_85m" | "over_1_85m";

export function reliefBand(price: number): ReliefBand {
  if (price <= FULL_RELIEF_CAP) return "under_1m";
  if (price <= FLAT_UNTIL) return "1m_1_5m";
  if (price < PHASE_OUT_END) return "1_5m_1_85m";
  return "over_1_85m";
}

/** Estimated HST relief in dollars for a new home at `price`, rounded to the dollar. */
export function hstRelief(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  switch (reliefBand(price)) {
    case "under_1m":
      return Math.round(price * HST_RATE);
    case "1m_1_5m":
      return FLAT_RELIEF;
    case "1_5m_1_85m": {
      const t = (price - FLAT_UNTIL) / (PHASE_OUT_END - FLAT_UNTIL);
      return Math.round(FLAT_RELIEF - t * (FLAT_RELIEF - OLD_REBATE));
    }
    default:
      return OLD_REBATE;
  }
}
