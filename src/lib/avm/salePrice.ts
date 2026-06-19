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

function avmComparable(estimate: AVMResult | null): SalePriceEstimate["comparable"] {
  if (!estimate || !(estimate.estimatedValue > 0)) return null;
  const low = estimate.lowBand > 0 ? estimate.lowBand : null;
  const high = estimate.highBand > 0 ? estimate.highBand : null;
  if (low === null || high === null || !(high > low)) return null;
  return { low, mid: estimate.estimatedValue, high };
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
    return {
      value: expectedPrice,
      lowBand: Math.round(expectedPrice * (1 - h)),
      highBand: Math.round(expectedPrice * (1 + h)),
      source: "expected-sale",
      confidence,
      deltaVsAskPct,
      provenance:
        "Anchored to the asking price and how recent comparable homes closed relative to ask.",
      market: { ratio, sampleSize, scope, windowMonths },
      comparable: avmComparable(estimate),
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
    };
  }

  return null;
}
