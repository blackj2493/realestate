/**
 * resolveSalePrice — THE single price estimate for a listing.
 *
 * The product previously showed TWO numbers on a listing: the list-BLIND AVM ("True
 * Value", ~11% median |%err|) and the list-AWARE Expected Sale (list × cohort close/list
 * ratio, ~2% median |%err|, ~81% within ±5% on held-out sales — see
 * scripts/admin/expected-sale-backtest.ts). Showing both confuses users. This collapses
 * them into ONE headline number, choosing the most accurate available method:
 *
 *   • Active listing WITH a trustworthy cohort close/list ratio
 *       → list-anchored Expected Sale is the headline (by far the most accurate; the list
 *         price embeds the listing agent's private condition/finish/micro-location signal
 *         the AVM can't see). The AVM is demoted to a secondary "comparable value" band
 *         shown as context, never as a competing headline.
 *   • Otherwise (thin cohort / no live ask / sold / off-market)
 *       → the list-blind AVM is the honest fallback headline.
 *
 * MEASURED, not asserted: blending the AVM INTO the point estimate was tested (the
 * (AVM−list)/list "arbitrage" signal) and moves close/list by <1pp across its whole range
 * while being most biased exactly at the 2M+ tail — so the AVM is deliberately kept OUT of
 * the point estimate and used only for deal-detection (Deal Score) + as the fallback.
 *
 * Pure (no IO) → unit-testable. Inputs are already-computed, already-VOW-gated upstream.
 */

import type { AVMResult } from "./types";
import type { ExpectedSale } from "./expectedSale";

export type SalePriceSource = "expected-sale" | "avm";

export interface SalePriceEstimate {
  /** The single headline number shown to the user. */
  value: number;
  /** Honest range around the headline. */
  lowBand: number;
  highBand: number;
  /** Which method produced the headline. */
  source: SalePriceSource;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** (value − listPrice) / listPrice; null when there is no live ask (sold/off-market). */
  deltaVsAskPct: number | null;
  /** Plain-English one-liner on how the number was derived. */
  provenance: string;
  /** Market-temperature context (present only for the list-anchored source). */
  market: {
    ratio: number;
    sampleSize: number;
    scope: "cohort" | "city";
    windowMonths: number;
  } | null;
  /** Independent comparable value (the AVM band) — secondary context, NEVER the headline. */
  comparable: { low: number; mid: number; high: number } | null;
  /**
   * Set ONLY when the listing looks deliberately under-priced for a bidding war: the AVM
   * comp value sits ≥ COMPETITIVE_COMP_MARGIN above the ask AND the ask matches one of the
   * measured under-listing price patterns (COMPETITIVE_PATTERNS). Drives the "Priced to
   * Compete" treatment — the card drops the "room to negotiate" framing for an
   * at-or-above-ask range + a calibrated over-ask probability. null otherwise.
   * Measured: scripts/admin/_thresholdPriceLift.ts, scripts/admin/_askDigitLift.ts.
   */
  competitive: {
    /** Which measured pattern fired. Every rate below is that pattern's OWN bucket — a rate
     *  measured on the "999" bucket does not describe any other, so the payload names the
     *  pattern rather than implying one global number. */
    pattern: CompetitivePattern;
    /** How far the ask sits below the comp mid: (compMid − list)/compMid (e.g. 0.21). */
    belowCompsPct: number;
    /** Over-ask base rate for the fired pattern's bucket — for the copy. */
    overAskRate: number;
    /** Floor of the "likely close" range — the ask. */
    rangeLow: number;
    /** Ceiling of the "likely close" range — comp low if above the ask, else comp mid. */
    rangeHigh: number;
    /** Measured median close/list for the fired pattern's bucket — the honest "likely close"
     *  anchor for hold-offers listings; the citywide cohort ratio does NOT apply to them. */
    medianCloseRatio: number;
  } | null;
}

/** Sample size at/above which a cohort close/list ratio is considered well-supported. */
export const RATIO_HIGH_CONFIDENCE_N = 50;

/**
 * Confidence-scaled half-width for the published "likely range" of a list-anchored estimate.
 * Calibrated to MEASURED coverage on 40k held-out 2026 sales (scripts/admin/_es-sweep.ts): a
 * ±4% band covers 75% of well-supported cohorts (n≥50) but only 68.5% of THIN cohorts (and
 * less on fresh listings still showing their original ask). So we keep HIGH/MEDIUM tight and
 * WIDEN the band for low-support cohorts — an honest range that reflects how much data backs
 * the ratio. (The point estimate is unchanged — model tuning has no measurable headroom; the
 * 13-config sweep sits flat at 2.10–2.18% median.)
 */
export const SALE_BAND_HALF_WIDTH: Record<SalePriceEstimate["confidence"], number> = {
  HIGH: 0.04,
  MEDIUM: 0.045,
  LOW: 0.06,
};

/**
 * A list price is "threshold-shaped" when it sits in the top $5k of a $100k band
 * ($x95,000–$x99,999 → $999,000, $1,299,000, $1,099,900…). Deterministic, list-only proxy
 * for a deliberately-attractive/under-market ask (the GTA "list at 999, hold offers" play).
 * Measured (scripts/admin/_thresholdPriceLift.ts, 105k held-out closings): homes priced
 * this way closed over ask 25.8% of the time vs 12.6% otherwise — and 39.8% when the ask
 * ALSO sat below comps (the combined trigger in detectCompetitive).
 */
export function isThresholdPrice(list: number): boolean {
  return list > 0 && list % 100_000 >= 95_000;
}

/** Names of the measured under-listing price patterns. See COMPETITIVE_PATTERNS. */
export type CompetitivePattern = "threshold";

/**
 * The measured under-listing patterns, each with the outcome rates of ITS OWN backtest
 * bucket (below-comps ∩ pattern). Adding a pattern is a data change, not a logic change —
 * but a new entry may only ship with rates measured on that pattern's own bucket.
 *
 * WHY A TABLE, not a single boolean: the previous gate recognised exactly one pattern (the
 * "999" play) and published one pair of rates. That silently made the digit shape a
 * REQUIREMENT for the whole signal — an ask of $688,000 sitting 28% below comps was
 * discarded before the comp test ran, because $88,000 is not $95,000+ (memory:
 * proxy-threshold-antipattern — a number standing in for a stated category). Splitting the
 * table keeps each published probability tied to the population it was measured on.
 *
 * `test` is list-price-only and deterministic; the comp test lives in detectCompetitive.
 */
export const COMPETITIVE_PATTERNS: ReadonlyArray<{
  name: CompetitivePattern;
  test: (list: number) => boolean;
  /** P(close > list) within below-comps ∩ this pattern. */
  overAskRate: number;
  /** Median close/list within the same bucket. Typically still < 1. */
  medianCloseRatio: number;
}> = [
  {
    name: "threshold",
    test: isThresholdPrice,
    overAskRate: 0.4,
    medianCloseRatio: 0.99,
  },
];

/** Over-ask base rate for the "threshold" pattern (below-comps + threshold price), straight
 *  from the backtest bucket — used verbatim in the "priced to compete" copy. NOT a promise:
 *  the median of that bucket still closes ~1% UNDER ask, so the UI shows a range +
 *  probability, never a confident above-ask number. */
export const COMPETITIVE_OVER_ASK_RATE = COMPETITIVE_PATTERNS[0].overAskRate;

/** Measured median close/list for the "threshold" pattern (same backtest bucket): the typical
 *  hold-offers home still closes ~1% UNDER ask. Every consumer of the competitive signal
 *  anchors "likely close" to THIS ratio, never to the citywide cohort ratio (often 3–5%
 *  under ask) — quoting the cohort figure on a deliberately under-listed home is what made
 *  the Suggested Move contradict the card's over-ask framing. */
export const COMPETITIVE_MEDIAN_CLOSE_RATIO = COMPETITIVE_PATTERNS[0].medianCloseRatio;

/** The first pattern whose list-price shape matches, or null. Order is significance order:
 *  the table is short and patterns are disjoint today, so first-match is unambiguous. */
export function matchCompetitivePattern(
  list: number,
): (typeof COMPETITIVE_PATTERNS)[number] | null {
  if (!(list > 0)) return null;
  return COMPETITIVE_PATTERNS.find((p) => p.test(list)) ?? null;
}

/** The AVM comp mid must clear the ask by at least this for a listing to count as "below
 *  comps" (matches the backtest's AVM>list margin; guards against the ~11% AVM noise). */
export const COMPETITIVE_COMP_MARGIN = 0.05;

function avmComparable(estimate: AVMResult | null): SalePriceEstimate["comparable"] {
  if (!estimate || !(estimate.estimatedValue > 0)) return null;
  const low = estimate.lowBand > 0 ? estimate.lowBand : null;
  const high = estimate.highBand > 0 ? estimate.highBand : null;
  if (low === null || high === null || !(high > low)) return null;
  return { low, mid: estimate.estimatedValue, high };
}

/**
 * Detect the "priced to compete" case: an ACTIVE listing whose ask is BOTH threshold-shaped
 * AND sits meaningfully below the AVM comp value. Returns the payload the card needs, or
 * null. Pure. Guards on AVM confidence — a LOW-confidence comp band is too noisy to call a
 * listing "under-priced". The range floor is the ask; the ceiling is the conservative comp
 * low (or the mid when the comp low is still under the ask).
 *
 * EXPORTED as the single detector for every surface that must agree on this pattern: the
 * Estimated Sale card (via resolveSalePrice), the Deal Score Suggested Move
 * (getListingDetail → computeDealScore), and The Read's price line (buildTheRead). Same
 * inputs → same verdict, so one surface can never call a listing a bidding-war setup while
 * another recommends an under-ask offer on it.
 */
export function detectCompetitive(
  listPrice: number,
  estimate: AVMResult | null,
): SalePriceEstimate["competitive"] {
  const comparable = avmComparable(estimate);
  if (!comparable || !(listPrice > 0)) return null;
  if (estimate && estimate.confidence === "LOW") return null;
  const pattern = matchCompetitivePattern(listPrice);
  if (!pattern) return null;
  if (!(comparable.mid >= listPrice * (1 + COMPETITIVE_COMP_MARGIN))) return null;
  return {
    pattern: pattern.name,
    belowCompsPct: (comparable.mid - listPrice) / comparable.mid,
    overAskRate: pattern.overAskRate,
    rangeLow: listPrice,
    rangeHigh: comparable.low > listPrice ? comparable.low : comparable.mid,
    medianCloseRatio: pattern.medianCloseRatio,
  };
}

/**
 * Resolve the one number. Returns null only when neither method can produce anything
 * (no live ask ratio AND no usable AVM) — the caller then shows an "unavailable" state.
 */
export function resolveSalePrice(opts: {
  listPrice: number | null;
  isActive: boolean;
  expectedSale: ExpectedSale | null;
  estimate: AVMResult | null;
}): SalePriceEstimate | null {
  const { listPrice, isActive, expectedSale, estimate } = opts;
  const hasAsk = typeof listPrice === "number" && listPrice > 0;

  // ── Preferred path: list-anchored Expected Sale on an active listing ──────────
  if (isActive && hasAsk && expectedSale && expectedSale.expectedPrice > 0) {
    const { expectedPrice, ratio, sampleSize, scope, windowMonths, deltaVsAskPct } = expectedSale;
    const confidence: SalePriceEstimate["confidence"] =
      scope === "cohort" && sampleSize >= RATIO_HIGH_CONFIDENCE_N
        ? "HIGH"
        : scope === "cohort" || sampleSize >= RATIO_HIGH_CONFIDENCE_N
          ? "MEDIUM"
          : "LOW";
    // Band scaled by how much data backs the ratio (calibrated; see SALE_BAND_HALF_WIDTH).
    const h = SALE_BAND_HALF_WIDTH[confidence];
    const comparable = avmComparable(estimate);
    return {
      value: expectedPrice,
      lowBand: Math.round(expectedPrice * (1 - h)),
      highBand: Math.round(expectedPrice * (1 + h)),
      source: "expected-sale",
      confidence,
      deltaVsAskPct,
      provenance:
        "Calibrated to how comparable homes recently sold relative to asking.",
      market: { ratio, sampleSize, scope, windowMonths },
      comparable,
      competitive: detectCompetitive(listPrice as number, estimate),
    };
  }

  // ── Fallback: list-blind AVM (thin cohort / sold / off-market / no live ask) ───
  if (estimate && estimate.estimatedValue > 0 && estimate.anchorPrice > 0) {
    return {
      value: estimate.estimatedValue,
      lowBand: estimate.lowBand > 0 ? estimate.lowBand : Math.round(estimate.estimatedValue * 0.9),
      highBand: estimate.highBand > 0 ? estimate.highBand : Math.round(estimate.estimatedValue * 1.1),
      source: "avm",
      confidence: estimate.confidence,
      deltaVsAskPct: hasAsk ? (estimate.estimatedValue - (listPrice as number)) / (listPrice as number) : null,
      provenance: isActive
        ? "Based on recent comparable sales (not enough recent sold-vs-ask data here to anchor to the asking price)."
        : "Based on recent comparable sales.",
      market: null,
      comparable: null,
      competitive: null,
    };
  }

  return null;
}
