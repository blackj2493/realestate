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
    /** Which ask shape qualified the listing. */
    pattern: CompetitivePattern;
    /** Which measured market supplied the numbers below. */
    market: CompetitiveMarket;
    /** How far the ask sits below the comp mid: (compMid − list)/compMid. */
    belowCompsPct: number;
    /** P(close > list) for THIS market at THIS comp-gap depth. */
    overAskRate: number;
    /** Median close/list for the same bucket. */
    medianCloseRatio: number;
    /** The typical outcome in dollars: ask × medianCloseRatio. The headline. */
    likelyClose: number;
    /** Floor of the published range — the typical close, not the ask. */
    rangeLow: number;
    /** Ceiling — ask × the bucket's 75th-percentile close/list. MEASURED, which is the
     *  whole point: it used to be the AVM's low band, an artifact that read as a forecast. */
    rangeHigh: number;
    /** Median close as a share of the comp mid (e.g. 0.822). Below 1 because the comp gap
     *  is largely AVM error on that home, not headroom. */
    closeVsCompMid: number;
    /** Share of the bucket that actually reached the comp mid (e.g. 0.054). The number that
     *  stops a reader assuming the home will sell at the comparable estimate. */
    reachedCompMid: number;
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
 * Which ask shapes qualify as "listed low to draw offers", and where. A pattern decides
 * ELIGIBILITY only — the numbers come from COMPETITIVE_GAP_RATES below, because what a
 * listing actually closes at is driven far more by HOW FAR under comps it sits than by
 * which digit convention the seller used.
 *
 * `markets` is where the shape was shown to carry lift. lucky-88 is GTA-only: just 17
 * non-GTA closings matched it, far too thin to act on.
 */
export const COMPETITIVE_PATTERNS: ReadonlyArray<{
  name: CompetitivePattern;
  test: (list: number) => boolean;
  markets: readonly CompetitiveMarket[];
}> = [
  // The "list at 999, hold offers" play: top $5k of a $100k band.
  { name: "threshold", test: isThresholdPrice, markets: ["gta", "other"] },
  // $_88,000–$_88,999 ($688,000, $888,000, $1,288,800…) — the GTA "lucky 8" ask.
  {
    name: "lucky-88",
    test: (list: number) => list > 0 && list % 100_000 >= 88_000 && list % 100_000 < 89_000,
    markets: ["gta"],
  },
];

/** Measured outcomes for one market at one comp-gap depth. Every figure is the observed
 *  value for that bucket — none is derived, assumed, or carried over from another. */
export interface CompetitiveOutcome {
  /** Lower edge of the comp gap this row describes: (compMid/list − 1). */
  minGap: number;
  /** P(close > list). */
  overAskRate: number;
  /** Median close/list — the typical outcome. */
  medianCloseRatio: number;
  /** 75th-percentile close/list — the "strong outcome" end of the published range. */
  p75CloseRatio: number;
  /** Median close as a share of the AVM comp mid. Well under 1: see the note below. */
  closeVsCompMid: number;
  /** Share of this bucket that actually reached the comp mid. */
  reachedCompMid: number;
}

/**
 * What these listings ACTUALLY close at, by market and by how far under comps they sit.
 *
 * THIS TABLE EXISTS BECAUSE THE CARD WAS MISLEADING. It used to publish one over-ask rate
 * per pattern, and set the top of its "likely close" range to the AVM's LOW band — a
 * confidence-interval artifact, not an outcome. Shown beside "listed ~21% below comparable
 * sales", that invited the reading that the home would close near the comp value. It does
 * not. Measured on 41,541 held-out sales: a GTA listing 20–30% under comps closes at a
 * median of 82.2% of the comp mid, and only 5.4% of them ever reach it. The comp gap is
 * mostly AVM ERROR on that specific home, not headroom waiting to be captured.
 *
 * The depth of the gap is the real predictor, and it is strong in the GTA (over-ask climbs
 * 40.9% → 61.0%, median close/list 0.990 → 1.050) and FLAT outside it (median close/list
 * never clears 1.0 at any depth). Pooling those was the same mistake one layer down.
 *
 * Source: scripts/admin/_askDigitLift.ts + the held-out replay; every bucket n >= 248.
 * Guarded by scripts/worker/competeRateDriftCheck.ts.
 */
export const COMPETITIVE_GAP_RATES: Readonly<Record<CompetitiveMarket, readonly CompetitiveOutcome[]>> = {
  gta: [
    { minGap: 0.05, overAskRate: 0.409, medianCloseRatio: 0.990, p75CloseRatio: 1.038, closeVsCompMid: 0.923, reachedCompMid: 0.165 }, // n=807
    { minGap: 0.10, overAskRate: 0.446, medianCloseRatio: 0.992, p75CloseRatio: 1.072, closeVsCompMid: 0.881, reachedCompMid: 0.126 }, // n=578
    { minGap: 0.15, overAskRate: 0.533, medianCloseRatio: 1.006, p75CloseRatio: 1.100, closeVsCompMid: 0.861, reachedCompMid: 0.092 }, // n=435
    { minGap: 0.20, overAskRate: 0.574, medianCloseRatio: 1.024, p75CloseRatio: 1.128, closeVsCompMid: 0.822, reachedCompMid: 0.054 }, // n=521
    { minGap: 0.30, overAskRate: 0.610, medianCloseRatio: 1.050, p75CloseRatio: 1.172, closeVsCompMid: 0.721, reachedCompMid: 0.015 }, // n=667
  ],
  other: [
    { minGap: 0.05, overAskRate: 0.132, medianCloseRatio: 0.975, p75CloseRatio: 0.992, closeVsCompMid: 0.907, reachedCompMid: 0.032 }, // n=409
    { minGap: 0.10, overAskRate: 0.199, medianCloseRatio: 0.975, p75CloseRatio: 1.000, closeVsCompMid: 0.868, reachedCompMid: 0.011 }, // n=272
    { minGap: 0.15, overAskRate: 0.238, medianCloseRatio: 0.975, p75CloseRatio: 1.000, closeVsCompMid: 0.831, reachedCompMid: 0.004 }, // n=248
    { minGap: 0.20, overAskRate: 0.236, medianCloseRatio: 0.971, p75CloseRatio: 1.000, closeVsCompMid: 0.780, reachedCompMid: 0.011 }, // n=276
    { minGap: 0.30, overAskRate: 0.258, medianCloseRatio: 0.967, p75CloseRatio: 1.000, closeVsCompMid: 0.647, reachedCompMid: 0.000 }, // n=631
  ],
};

/** The deepest band whose minGap the listing clears, or null when it does not even reach
 *  the shallowest. Bands are ascending, so this is a scan from the bottom. */
export function competitiveOutcomeFor(
  market: CompetitiveMarket,
  gap: number,
): CompetitiveOutcome | null {
  let hit: CompetitiveOutcome | null = null;
  for (const band of COMPETITIVE_GAP_RATES[market]) {
    if (gap >= band.minGap) hit = band;
    else break;
  }
  return hit;
}

/** The first pattern whose shape matches and that was measured in this market, else null. */
export function matchCompetitivePattern(
  list: number,
  market: CompetitiveMarket,
): CompetitivePattern | null {
  if (!(list > 0)) return null;
  const hit = COMPETITIVE_PATTERNS.find((p) => p.test(list) && p.markets.includes(market));
  return hit ? hit.name : null;
}

/** The AVM comp mid must clear the ask by at least this for a listing to count as "below
 *  comps" at all. Also the shallowest band in COMPETITIVE_GAP_RATES, so the two agree. */
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
  /** The listing's municipality (payload.City). Selects the measured market. */
  city: string | null,
): SalePriceEstimate["competitive"] {
  const comparable = avmComparable(estimate);
  if (!comparable || !(listPrice > 0)) return null;
  if (estimate && estimate.confidence === "LOW") return null;
  const market = competitiveMarketOf(city);
  const pattern = matchCompetitivePattern(listPrice, market);
  if (!pattern) return null;
  // How far under comps the ask sits. Drives every number below — depth matters far more
  // than which digit convention produced the ask.
  const gap = comparable.mid / listPrice - 1;
  if (gap < COMPETITIVE_COMP_MARGIN) return null;
  const outcome = competitiveOutcomeFor(market, gap);
  if (!outcome) return null;
  return {
    pattern,
    market,
    belowCompsPct: (comparable.mid - listPrice) / comparable.mid,
    overAskRate: outcome.overAskRate,
    medianCloseRatio: outcome.medianCloseRatio,
    likelyClose: Math.round(listPrice * outcome.medianCloseRatio),
    rangeLow: Math.round(listPrice * outcome.medianCloseRatio),
    rangeHigh: Math.round(listPrice * outcome.p75CloseRatio),
    closeVsCompMid: outcome.closeVsCompMid,
    reachedCompMid: outcome.reachedCompMid,
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
