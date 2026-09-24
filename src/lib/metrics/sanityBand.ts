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
 * rents), published at the rent index's MIN_COHORT_SAMPLES floor (rentModel.ts, now 3
 * leases per cohort — see the backtest table there). Not VOW-derived.
 */
/**
 * Plausible MONTHLY RENT for a dwelling, in dollars.
 *
 * Lived only in scripts/worker/services/rentModel.ts, where the rent ladder used it to
 * reject a lease record before it could key a cohort. Nothing on the web side could
 * reach it, so the address page's "Median rent" tile queried for-lease listings with a
 * $500 floor and NO ceiling.
 *
 * That published $120,300/mo on a Kearney address on 2026-08-21. The area had exactly
 * two for-lease records within 12km — a $2,600 detached and a $238,000 VACANT LAND
 * listing carrying what is plainly a sale price — and the median of two is the midpoint.
 * Index-wide only 15 of 19,611 residential lease documents sit above $25,000, so this
 * costs almost nothing in a dense market and saves every thin one.
 */
export const MONTHLY_RENT_BAND = { min: 500, max: 25_000 } as const; // dollars/month

/** Returns the monthly rent if plausible for a dwelling, else null. */
export function monthlyRentOrNull(v: number | null | undefined): number | null {
  return inBandOrNull(v, MONTHLY_RENT_BAND.min, MONTHLY_RENT_BAND.max);
}

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

/**
 * Plausible monthly rent CEILING by TRREB living-area band, from 261,896 signed leases
 * that carry a size band. Each `max` is the band's own 99.5th percentile.
 *
 * WHY PER BAND, NOT A FLAT $/SQFT RULE. A flat rent-per-square-foot ceiling was the
 * obvious guard and the data killed it: 8.3% of real leases clear $5/sqft, and a 250 sqft
 * studio at $2,100/mo — $8.40/sqft — is simply a normal downtown studio. Rent per square
 * foot falls steeply with size, so one threshold either passes everything or rejects every
 * small unit. The rent a given SIZE actually commands is the stable thing, so that is what
 * is bounded.
 *
 * WHAT IT CATCHES. The rent ladder keys on region/city x type x beds x baths and has no
 * size dimension at all, so bathroom count silently acts as a size proxy. On 130 River St
 * #1508 — 650 sqft, listed with 3 bathrooms — that proxy inverted: the cohort it matched
 * (Toronto C08, 2 bed, 3 bath, n=31) is made of 1,900 sqft Merchants' Wharf and Queens Quay
 * penthouses, and it published $5,200/mo. Two units in that same building, same size, leased
 * that month for $2,900 and $3,000. $5,200 sits above 99.99% of the 41,269 real 650 sqft
 * leases in the feed.
 *
 * Applied in fetchRentAVM to SKIP a rung rather than to blank the answer: a cohort that
 * fails here is a wrong cohort, and the next rung down is usually right (on that listing the
 * bath-matched rung failed and the size-agnostic city rung returned $2,600).
 *
 * Calibrated on individual leases but applied to cohort MEDIANS, which are far less
 * dispersed — so the real false-positive rate is well under the 0.5% the percentile implies.
 * Regenerate from raw_vow_sold lease rows grouped by living_area_range if the market moves.
 */
export const RENT_CEILING_BY_SIZE: ReadonlyArray<{ sqft: number; max: number }> = [
  { sqft: 250, max: 3_100 },
  { sqft: 550, max: 3_000 },
  { sqft: 650, max: 3_400 },
  { sqft: 700, max: 4_750 },
  { sqft: 750, max: 3_975 },
  { sqft: 850, max: 4_575 },
  { sqft: 900, max: 4_750 },
  { sqft: 950, max: 5_000 },
  { sqft: 1_100, max: 6_500 },
  { sqft: 1_300, max: 6_980 },
  { sqft: 1_500, max: 12_000 },
  { sqft: 1_700, max: 16_000 },
  { sqft: 1_750, max: 6_900 },
  { sqft: 1_900, max: 17_500 },
  { sqft: 2_125, max: 20_500 },
  { sqft: 2_250, max: 9_990 },
  { sqft: 2_375, max: 18_000 },
  { sqft: 2_750, max: 14_000 },
  { sqft: 3_250, max: 15_000 },
  { sqft: 4_250, max: 26_000 },
  { sqft: 5_000, max: 30_000 },
];

/** Midpoint of a TRREB living-area band ("600-699" -> 650), or null. Accepts a bare
 *  number too, since raw_vow_sold already stores the midpoint. */
export function livingAreaMidpoint(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const range = v.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  const n = Number(v.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Highest plausible monthly rent for a dwelling of this size, or null when the size is
 * unknown or larger than the table covers — in which case the caller must NOT gate, because
 * "no ceiling" is not the same as "zero".
 */
export function rentCeilingForSize(v: string | number | null | undefined): number | null {
  const sqft = livingAreaMidpoint(v);
  if (sqft === null) return null;
  // Nearest band at or above the size; the top row also covers anything larger.
  for (const b of RENT_CEILING_BY_SIZE) if (sqft <= b.sqft) return b.max;
  return null;
}

/** True when this cohort rent is impossible for a dwelling of this size. Unknown size or
 *  unknown rent is never "implausible" — absence of evidence is not evidence. */
export function rentImplausibleForSize(
  monthlyRent: number | null | undefined,
  livingArea: string | number | null | undefined,
): boolean {
  const ceiling = rentCeilingForSize(livingArea);
  if (ceiling === null) return false;
  return typeof monthlyRent === "number" && Number.isFinite(monthlyRent) && monthlyRent > ceiling;
}
