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
    /** Which measured market supplied the rates below. */
    market: CompetitiveMarket;
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
export type CompetitivePattern = "threshold" | "lucky-88";

/**
 * The markets these rates were measured on, separately. Hold-back-offers pricing is a
 * LOCAL convention, and the outcome gap is not subtle: on the same "999" ask sitting below
 * comps, GTA homes closed over ask 54.5% of the time and the rest of Ontario 22.5%
 * (scripts/admin/_askDigitLift.ts, 24mo, n=2,306 / n=1,650). One pooled number cannot
 * describe both — see COMPETITIVE_PATTERNS.
 */
export type CompetitiveMarket = "gta" | "other";

/**
 * Municipalities the "gta" rates were measured on — Toronto's 416 district codes plus the
 * four regional municipalities. Matched on the listing's City. Toronto arrives as a TRREB
 * district string ("Toronto C12", "Toronto W05"), never bare "Toronto", so this is a prefix
 * test, not an equality test (memory: trreb-city-taxonomy).
 */
const GTA_CITY_PREFIXES = [
  "toronto",
  // York
  "markham", "richmond hill", "vaughan", "aurora", "newmarket", "king",
  "whitchurch", "east gwillimbury", "georgina",
  // Peel
  "mississauga", "brampton", "caledon",
  // Halton
  "oakville", "burlington", "milton", "halton hills",
  // Durham
  "pickering", "ajax", "whitby", "oshawa", "clarington", "scugog", "uxbridge", "brock",
] as const;

/** Which measured market a listing's municipality belongs to. Unknown/blank → "other", the
 *  conservative bucket: it publishes the LOWER over-ask rate, and patterns measured only in
 *  the GTA do not fire at all. */
export function competitiveMarketOf(city: string | null | undefined): CompetitiveMarket {
  const c = (city ?? "").trim().toLowerCase();
  if (!c) return "other";
  return GTA_CITY_PREFIXES.some((p) => c.startsWith(p)) ? "gta" : "other";
}

/** Outcome rates for one pattern in one market. Both are measured on that exact bucket. */
export interface CompetitiveRates {
  /** P(close > list) within below-comps ∩ pattern ∩ market. */
  overAskRate: number;
  /** Median close/list within the same bucket. */
  medianCloseRatio: number;
}

/**
 * The measured under-listing patterns. Each carries the outcome rates of ITS OWN backtest
 * bucket, PER MARKET. A null market entry means "not measured here" — the pattern simply
 * does not fire there, rather than borrowing another market's number.
 *
 * WHY A TABLE, not a single boolean + a single rate: the previous gate recognised exactly
 * one pattern (the "999" play) and published one pooled rate to everyone. That caused two
 * separate defects.
 *
 *   1. It made the digit shape a REQUIREMENT for the whole signal. An ask of $688,000
 *      sitting 28% below comps was discarded before the comp test ran, because $88,000 is
 *      not $95,000+ — even though $_88,000 turns out to be the STRONGEST band in the data
 *      (memory: proxy-threshold-antipattern — a number standing in for a stated category).
 *   2. It quoted one number to markets that behave nothing alike. 41.7% of the homes the
 *      gate fired on are outside the GTA, where the real over-ask rate is 22.5%, not the
 *      40% the card printed — a 17.5pp overstatement to four in ten readers.
 *
 * All figures: scripts/admin/_askDigitLift.ts over 238,874 closings (24mo), restricted to
 * the 14,976 an out-of-sample AVM run priced >=5% above their ask. `test` is
 * list-price-only and deterministic; the comp test lives in detectCompetitive.
 */
export const COMPETITIVE_PATTERNS: ReadonlyArray<{
  name: CompetitivePattern;
  test: (list: number) => boolean;
  rates: Readonly<Record<CompetitiveMarket, CompetitiveRates | null>>;
}> = [
  {
    // The "list at 999, hold offers" play: top $5k of a $100k band.
    name: "threshold",
    test: isThresholdPrice,
    rates: {
      gta: { overAskRate: 0.545, medianCloseRatio: 1.011 }, // n=2,306
      other: { overAskRate: 0.225, medianCloseRatio: 0.972 }, // n=1,650
    },
  },
  {
    // $_88,000–$_88,999 ($688,000, $888,000, $1,288,800…). The GTA "lucky 8" ask. Measured
    // over-ask 45.9% in the GTA — ahead of the "999" play — on n=233. NOT shipped outside
    // the GTA: only 17 non-GTA closings matched, far too thin to publish a probability.
    name: "lucky-88",
    test: (list: number) => list > 0 && list % 100_000 >= 88_000 && list % 100_000 < 89_000,
    rates: {
      gta: { overAskRate: 0.459, medianCloseRatio: 0.992 }, // n=233
      other: null, // n=17 — not measurable
    },
  },
];

/** The first pattern that matches BOTH the ask's shape and a market we measured it in, with
 *  that market's rates. Returns null when no pattern applies. Order is significance order;
 *  the patterns are disjoint today, so first-match is unambiguous. */
export function matchCompetitivePattern(
  list: number,
  market: CompetitiveMarket,
): { name: CompetitivePattern; rates: CompetitiveRates } | null {
  if (!(list > 0)) return null;
  for (const p of COMPETITIVE_PATTERNS) {
    if (!p.test(list)) continue;
    const rates = p.rates[market];
    if (rates) return { name: p.name, rates };
  }
  return null;
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
  /** The listing's municipality (payload.City). Decides WHICH measured rates apply — the
   *  same ask shape carries a 54.5% over-ask rate in the GTA and 22.5% outside it, so this
   *  is not optional context. Null/unknown resolves to the conservative "other" bucket. */
  city: string | null,
): SalePriceEstimate["competitive"] {
  const comparable = avmComparable(estimate);
  if (!comparable || !(listPrice > 0)) return null;
  if (estimate && estimate.confidence === "LOW") return null;
  const market = competitiveMarketOf(city);
  const pattern = matchCompetitivePattern(listPrice, market);
  if (!pattern) return null;
  if (!(comparable.mid >= listPrice * (1 + COMPETITIVE_COMP_MARGIN))) return null;
  return {
    pattern: pattern.name,
    market,
    belowCompsPct: (comparable.mid - listPrice) / comparable.mid,
    overAskRate: pattern.rates.overAskRate,
    rangeLow: listPrice,
    rangeHigh: comparable.low > listPrice ? comparable.low : comparable.mid,
    medianCloseRatio: pattern.rates.medianCloseRatio,
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
  /** The listing's municipality (payload.City) — required, because the "priced to compete"
   *  rates are market-specific. Pass null only when the feed genuinely has no City; that
   *  resolves to the conservative bucket rather than borrowing the GTA's numbers. */
  city: string | null;
}): SalePriceEstimate | null {
  const { listPrice, isActive, expectedSale, estimate, city } = opts;
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
      competitive: detectCompetitive(listPrice as number, estimate, city),
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
