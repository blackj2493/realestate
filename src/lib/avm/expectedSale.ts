/**
 * Expected Sale Price — the list-AWARE second number (deterministic, no LLM, §4).
 *
 *   ExpectedSale = listPrice × R
 *
 * where R is a leakage-safe estimate of the cohort's recent close/list ratio (how the
 * market has been paying relative to ask). Where the list-blind AVM answers "what should
 * a *similar* home go for?" (~11% median |%err|, an intrinsic reference shown as a range),
 * this answers "what will *this* listing actually close at?" — and backtests at ~2.1%
 * median |%err| on 41k held-out sales, because the list price already embeds the listing
 * agent's private home knowledge (condition/finish/micro-location) the AVM can't see.
 *
 * Spec + backtest: `.claude/docs/avm/expected-sale-price.md`,
 * `scripts/admin/expected-sale-backtest.ts`. list_price is public / IDX-displayable, so
 * using it is legal; the ratio is derived from raw_vow_sold so the OUTPUT stays VOW-gated.
 *
 * This module is PURE (no IO) so it is unit-testable; the ratio itself is fetched
 * server-side in `src/lib/property/getCloseListRatio.ts`.
 */

/** A cohort's recent close/list ratio, the multiplier R. */
export interface CloseListRatio {
  /** Median close/list over the cohort's recent window (e.g. 0.965 = sells ~3.5% under ask). */
  ratio: number;
  /** Number of comparable sold/list pairs behind the ratio. */
  sampleSize: number;
  /** Trailing window the ratio was measured over, in months. */
  windowMonths: number;
  /** 'cohort' = city × sub-type; 'city' = city all-types fallback (thin cohort). */
  scope: "cohort" | "city";
}

export interface ExpectedSale {
  expectedPrice: number;
  /** Honest band (see EXPECTED_SALE_REL_HALF_WIDTH). */
  lowBand: number;
  highBand: number;
  ratio: number;
  sampleSize: number;
  scope: "cohort" | "city";
  windowMonths: number;
  /** (expectedPrice − listPrice) / listPrice. Negative ⇒ expected to close below ask. */
  deltaVsAskPct: number;
}

/**
 * Typical-error half-width for the published range. The backtest median |%err| is ~2.1%
 * and MAPE ~3.5%; we use 4% to (a) reflect MAPE not the optimistic median and (b) carry
 * the fresh-listing caveat — the ratio is fit on the LAST (post-reduction) list of sold
 * homes, so an active listing still showing its original ask is modestly less certain.
 */
export const EXPECTED_SALE_REL_HALF_WIDTH = 0.04;

/** Below this many comparable sold/list pairs we don't trust the ratio (caller passes null). */
export const MIN_RATIO_SAMPLES = 12;

export function computeExpectedSale(
  listPrice: number,
  r: CloseListRatio | null
): ExpectedSale | null {
  if (!r || !(listPrice > 0) || !(r.ratio > 0)) return null;
  const expectedPrice = Math.round(listPrice * r.ratio);
  if (!(expectedPrice > 0)) return null;
  const h = EXPECTED_SALE_REL_HALF_WIDTH;
  return {
    expectedPrice,
    lowBand: Math.round(expectedPrice * (1 - h)),
    highBand: Math.round(expectedPrice * (1 + h)),
    ratio: r.ratio,
    sampleSize: r.sampleSize,
    scope: r.scope,
    windowMonths: r.windowMonths,
    deltaVsAskPct: (expectedPrice - listPrice) / listPrice,
  };
}

/** Clamped position (0..1) of `value` along a [min,max] domain — for the lineup axis. */
export function axisPosition(value: number, min: number, max: number): number {
  if (!(max > min)) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Domain [min,max] spanning the lineup markers with a small pad so end markers aren't clipped. */
export function lineupDomain(points: number[]): { min: number; max: number } {
  const xs = points.filter((x) => Number.isFinite(x) && x > 0);
  if (xs.length === 0) return { min: 0, max: 1 };
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (hi === lo) return { min: lo * 0.96, max: hi * 1.04 };
  const pad = (hi - lo) * 0.08;
  return { min: lo - pad, max: hi + pad };
}
