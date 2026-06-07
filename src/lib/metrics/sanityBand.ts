/**
 * Render-time sanity band for the real cap-rate / gross-yield fields.
 *
 * Catches tier-fallback mismatch at the extremes (a luxury home handed a coarse
 * city rent → spuriously low; a cheap unit handed a too-high comp → spuriously
 * high). FIELD-LEVEL suppression only (spec §4.1): a garbage value blanks the
 * CELL, never drops the listing. NEVER use these bounds as a default global query
 * filter — fold them into filter_by only when the user actively sorts/filters by
 * the metric.
 *
 * Units: both fields are PERCENT (cap_rate_est = NOI/price*100,
 * gross_yield_est = rent/price*100), per financialMetrics.ts.
 *
 * Compliance (spec §3): IDX-only metric (own list price × active for-lease asking
 * rents), shipped at the rent index's N≥5 floor. Not VOW-derived.
 */
export const CAP_RATE_BAND = { min: 1, max: 15 } as const; // percent
export const GROSS_YIELD_BAND = { min: 1.5, max: 18 } as const; // percent

function inBandOrNull(v: number | null | undefined, lo: number, hi: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

/** Returns the cap rate (%) if plausibly in-band, else null (→ render "—"). */
export function capRateOrNull(v: number | null | undefined): number | null {
  return inBandOrNull(v, CAP_RATE_BAND.min, CAP_RATE_BAND.max);
}

/** Returns the gross yield (%) if plausibly in-band, else null (→ render "—"). */
export function grossYieldOrNull(v: number | null | undefined): number | null {
  return inBandOrNull(v, GROSS_YIELD_BAND.min, GROSS_YIELD_BAND.max);
}

/**
 * True when the listing carries any real rent-derived estimate. Gates the
 * (currently orphan) cashflow surfaces per spec §4.2 — exported now so the rule is
 * enforceable the moment a cashflow display/sort/filter is wired.
 */
export function hasRentEstimate(doc: {
  cap_rate_est?: number | null;
  gross_yield_est?: number | null;
}): boolean {
  return (
    (typeof doc.cap_rate_est === "number" && doc.cap_rate_est > 0) ||
    (typeof doc.gross_yield_est === "number" && doc.gross_yield_est > 0)
  );
}
