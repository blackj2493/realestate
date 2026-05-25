/**
 * Deal Score — deterministic 0–100 investor-grade score for a single listing.
 *
 * The flagship behavioral hook of the property detail view: one number + letter
 * grade that answers "how good a deal is this?", with a transparent breakdown so
 * the score feels earned rather than arbitrary.
 *
 * COMPLIANCE (CLAUDE.md §4): pure deterministic arithmetic over data we already
 * derive — NO LLM/AI transformation of listing data. Every threshold is a named
 * constant so the model is auditable and tunable in one place. This is OUR metric,
 * not an MLS/TRREB figure (the UI must show that disclaimer).
 *
 * Each component is scored 0–100 from documented anchor points (piecewise-linear,
 * so the score moves smoothly with the market). A component is included ONLY when
 * its underlying data is present; the final score is a weighted average
 * renormalized over the present components, so missing data never tanks the score.
 */

export type DealScoreGrade = "A+" | "A" | "B" | "C" | "D" | "F";

export type DealScoreDirection = "up" | "down" | "neutral";

export interface DealScoreComponent {
  key: "value" | "motivation" | "leverage" | "yield";
  label: string;
  /** 0–100 sub-score for this dimension. */
  points: number;
  /** Effective weight used in the renormalized average. */
  weight: number;
  /** Buyer-favorable (up), buyer-unfavorable (down), or neutral. */
  direction: DealScoreDirection;
  /** Human-readable one-liner explaining the sub-score. */
  detail: string;
}

export interface DealScoreInput {
  listPrice: number | null | undefined;
  originalListPrice?: number | null;
  avmEstimate?: {
    estimatedValue: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  } | null;
  /** Days on market (True/calculated DOM). */
  domDays?: number | null;
  /** Extrapolated cap rate as a whole-number percent (e.g. 6.5 for 6.5%). */
  capRatePct?: number | null;
}

export interface DealScoreResult {
  /** Final 0–100 score, or null when no component had data. */
  score: number | null;
  grade: DealScoreGrade | null;
  verdict: string;
  components: DealScoreComponent[];
}

// ── Base weights (v1: balanced; persona re-weighting is a later phase) ──────────
const WEIGHT_VALUE = 35;
const WEIGHT_MOTIVATION = 25;
const WEIGHT_LEVERAGE = 20;
const WEIGHT_YIELD = 20;

// Value-vs-Estimate weight is scaled by how much we trust the AVM.
const CONFIDENCE_MULTIPLIER: Record<"HIGH" | "MEDIUM" | "LOW", number> = {
  HIGH: 1.0,
  MEDIUM: 0.7,
  LOW: 0.4,
};

// ── Scoring anchors: [inputValue, points]. Ascending; piecewise-linear between. ──
// Value vs Estimate: discount % = (estimate − list) / estimate × 100. Higher = cheaper.
const VALUE_ANCHORS: Array<[number, number]> = [
  [-15, 0],
  [-5, 25],
  [0, 50],
  [5, 78],
  [10, 92],
  [15, 100],
];

// Seller Motivation: price cut % off the original ask. Bigger cut = more motivated.
const MOTIVATION_ANCHORS: Array<[number, number]> = [
  [0, 35],
  [2, 55],
  [5, 75],
  [10, 92],
  [15, 100],
];

// Negotiation Leverage: days on market. Longer = more buyer leverage.
const LEVERAGE_ANCHORS: Array<[number, number]> = [
  [0, 30],
  [14, 45],
  [30, 65],
  [60, 85],
  [90, 100],
];

// Yield: extrapolated cap rate %. Higher = stronger yield on cost.
const YIELD_ANCHORS: Array<[number, number]> = [
  [2, 20],
  [4, 45],
  [6, 70],
  [8, 88],
  [10, 100],
];

// ── Grade bands (tunable) ───────────────────────────────────────────────────────
const GRADE_BANDS: Array<[number, DealScoreGrade, string]> = [
  [85, "A+", "Exceptional deal — priced well below the signals we track."],
  [75, "A", "Strong deal — multiple metrics favor the buyer."],
  [65, "B", "Solid opportunity with real room to negotiate."],
  [55, "C", "Fairly priced — buyer leverage is limited."],
  [45, "D", "Priced ahead of the fundamentals."],
  [0, "F", "Overpriced on the metrics we track."],
];

/** Direction thresholds: how a sub-score maps to an arrow. */
const UP_AT = 60;
const DOWN_AT = 40;

/** Piecewise-linear interpolation across ascending [x, y] anchors, clamped at ends. */
function interpolate(value: number, anchors: Array<[number, number]>): number {
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (value >= x0 && value <= x1) {
      const t = (value - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

function directionFor(points: number): DealScoreDirection {
  if (points >= UP_AT) return "up";
  if (points <= DOWN_AT) return "down";
  return "neutral";
}

function gradeFor(score: number): { grade: DealScoreGrade; verdict: string } {
  for (const [min, grade, verdict] of GRADE_BANDS) {
    if (score >= min) return { grade, verdict };
  }
  const [, grade, verdict] = GRADE_BANDS[GRADE_BANDS.length - 1];
  return { grade, verdict };
}

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-CA")}`;
}

/**
 * Compute the Deal Score from already-derived listing metrics. Pure & deterministic:
 * identical inputs always yield an identical result.
 */
export function computeDealScore(input: DealScoreInput): DealScoreResult {
  const listPrice =
    typeof input.listPrice === "number" && input.listPrice > 0 ? input.listPrice : null;
  const components: DealScoreComponent[] = [];

  // ── Value vs Estimate ──────────────────────────────────────────────────────
  if (listPrice && input.avmEstimate && input.avmEstimate.estimatedValue > 0) {
    const est = input.avmEstimate.estimatedValue;
    const discountPct = ((est - listPrice) / est) * 100;
    const points = interpolate(discountPct, VALUE_ANCHORS);
    const weight = WEIGHT_VALUE * CONFIDENCE_MULTIPLIER[input.avmEstimate.confidence];
    const absPct = Math.abs(discountPct);
    const detail =
      discountPct >= 0.5
        ? `Listed ${absPct.toFixed(1)}% below our ${fmtMoney(est)} estimate (${input.avmEstimate.confidence.toLowerCase()} confidence)`
        : discountPct <= -0.5
        ? `Listed ${absPct.toFixed(1)}% above our ${fmtMoney(est)} estimate (${input.avmEstimate.confidence.toLowerCase()} confidence)`
        : `Priced in line with our ${fmtMoney(est)} estimate (${input.avmEstimate.confidence.toLowerCase()} confidence)`;
    components.push({
      key: "value",
      label: "Value vs Estimate",
      points,
      weight,
      direction: directionFor(points),
      detail,
    });
  }

  // ── Seller Motivation (price cuts) ─────────────────────────────────────────
  if (listPrice && typeof input.originalListPrice === "number" && input.originalListPrice > 0) {
    const orig = input.originalListPrice;
    const cutPct = orig > listPrice ? ((orig - listPrice) / orig) * 100 : 0;
    const points = interpolate(cutPct, MOTIVATION_ANCHORS);
    const detail =
      cutPct >= 0.5
        ? `Reduced ${cutPct.toFixed(1)}% from the original ${fmtMoney(orig)} ask`
        : "No price reductions yet — seller is holding firm";
    components.push({
      key: "motivation",
      label: "Seller Motivation",
      points,
      weight: WEIGHT_MOTIVATION,
      direction: directionFor(points),
      detail,
    });
  }

  // ── Negotiation Leverage (days on market) ──────────────────────────────────
  if (typeof input.domDays === "number" && input.domDays >= 0) {
    const dom = input.domDays;
    const points = interpolate(dom, LEVERAGE_ANCHORS);
    const detail =
      dom >= 60
        ? `${dom} days on market — strong buyer leverage`
        : dom >= 30
        ? `${dom} days on market — building leverage`
        : dom >= 14
        ? `${dom} days on market — modest leverage`
        : `${dom} days on market — fresh listing, little leverage`;
    components.push({
      key: "leverage",
      label: "Negotiation Leverage",
      points,
      weight: WEIGHT_LEVERAGE,
      direction: directionFor(points),
      detail,
    });
  }

  // ── Yield (extrapolated cap rate) ──────────────────────────────────────────
  if (typeof input.capRatePct === "number" && input.capRatePct > 0) {
    const cap = input.capRatePct;
    const points = interpolate(cap, YIELD_ANCHORS);
    const detail = `Extrapolated cap rate of ${cap.toFixed(1)}% on stabilized cost`;
    components.push({
      key: "yield",
      label: "Yield",
      points,
      weight: WEIGHT_YIELD,
      direction: directionFor(points),
      detail,
    });
  }

  // ── Renormalized weighted average over present components ───────────────────
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  if (components.length === 0 || totalWeight <= 0) {
    return { score: null, grade: null, verdict: "Not enough data to score this listing.", components };
  }

  const weighted = components.reduce((sum, c) => sum + c.points * c.weight, 0);
  const score = Math.round(weighted / totalWeight);
  const { grade, verdict } = gradeFor(score);

  return { score, grade, verdict, components };
}

export default computeDealScore;
