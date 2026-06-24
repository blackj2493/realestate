/**
 * Deal Score (v2 "Deal Read") — deterministic 0–100 investor-grade score for a listing.
 *
 * The flagship behavioral hook of the property detail view: one number + letter grade
 * that answers "how good a deal is this — for ME?", with a transparent breakdown and a
 * suggested-offer band so the score drives a decision, not just a reaction.
 *
 * WHAT CHANGED FROM v1 (and why):
 *  • Four PILLARS (Price / Terms / Yield / Upside) replace the flat 4-component average.
 *  • PERSONA-CONDITIONED: each of the app's four personas (smart/cashflow/flippers/
 *    builders, see personaConfig.ts) weights the pillars differently and the headline is
 *    a renormalized blend. A homebuyer never sees Yield; a cashflow investor leans on it.
 *    This alone fixes the "fairly-priced family home scores F" problem: dropping the
 *    irrelevant 2.8%-cap Yield penalty for the homebuyer lens.
 *  • Yield is scored ASSET-CLASS-RELATIVE (a 2.8% cap is median for a detached SFH but
 *    bottom-decile for a plex) instead of on one absolute curve that punished every house.
 *  • Grade bands recalibrated so a fairly-priced listing lands ~C, not F.
 *  • Emits a SUGGESTED OFFER BAND (the one output a user can't compute themselves).
 *  • Emits ALL four persona grades so the UI can switch lenses with no recompute.
 *
 * DEFERRED (need infra; marked here so the static stand-ins are obvious):
 *  • Yield/price percentiles vs the LIVE active cohort (needs a cohort query + cache) —
 *    here approximated by a static per-asset-class cap baseline (ASSET_CLASS_CAP_BASELINE).
 *  • Grade on the population CURVE (needs a daily calibration table) — here hand-set bands.
 *  • Field rank, track-record backtest, score history/alerts.
 *
 * COMPLIANCE (CLAUDE.md §4): pure deterministic arithmetic over data we already derive —
 * NO LLM/AI transformation of listing data. Every threshold is a named constant so the
 * model is auditable and tunable in one place. This is OUR metric, not an MLS/TRREB figure
 * (the UI must show that disclaimer).
 */

export type DealScoreGrade = "A+" | "A" | "B" | "C" | "D" | "F";

export type DealScoreDirection = "up" | "down" | "neutral";

/** The four lenses — mirror personaConfig.ts PersonaType exactly. */
export type DealPersona = "smart" | "cashflow" | "flippers" | "builders";

export type PillarKey = "price" | "terms" | "yield" | "upside";

export interface DealScoreComponent {
  key: PillarKey;
  label: string;
  /** 0–100 sub-score for this pillar. */
  points: number;
  /** Effective (renormalized) weight this pillar carried in the active persona's blend. */
  weight: number;
  /** Buyer-favorable (up), buyer-unfavorable (down), or neutral. */
  direction: DealScoreDirection;
  /** Human-readable one-liner explaining the sub-score. */
  detail: string;
  /**
   * The comp-value dollar behind the Price pillar (the AVM). Shown ONLY in the expanded
   * breakdown, clearly labeled "comp value" — never in the headline copy / The Read, where
   * the single Estimated Sale Price is the number. Absent on other pillars.
   */
  compValue?: number;
}

/** A suggested-offer band derived from the list-anchored expected close + comps + motivation. */
export interface OfferBand {
  /** Low end of a defensible offer (motivation-nudged below the likely close). */
  aggressive: number;
  /** What the listing will most likely close at (list-anchored Expected Sale). */
  likelyClose: number;
  /** Paying above this means overpaying vs BOTH comps and the likely close. */
  ceiling: number;
  /** Plain-English move. */
  note: string;
  /** Cohort closes ABOVE ask → the band shifts up and the copy says "expect to compete". */
  hotMarket: boolean;
  /**
   * Provenance of `likelyClose`: the list-anchored Expected Sale model (~2% median
   * |%err|, carries close-rate data) vs the AVM fallback (~11%, NO close-rate signal).
   * When AVM-based, `note` degrades so the copy never claims comparable-closing support
   * it doesn't have — and the UI can flag the band as indicative.
   */
  basis: "expected-sale" | "avm";
}

/** A single persona's headline (for the lens switcher). */
export interface PersonaGrade {
  score: number | null;
  grade: DealScoreGrade | null;
  verdict: string;
}

/**
 * A pillar's persona-INDEPENDENT data (raw points/detail). A pillar's points don't change
 * by persona — only whether it's included and how it's weighted does. Shipping these lets
 * the UI re-render the breakdown for any lens client-side (paired with PERSONA_WEIGHTS).
 */
export interface DealPillar {
  key: PillarKey;
  label: string;
  points: number;
  direction: DealScoreDirection;
  detail: string;
  compValue?: number;
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
  /** Property sub-type — selects the asset-class yield baseline. */
  subType?: string | null;
  /** List-anchored expected close ($) — drives the offer band. */
  expectedSalePrice?: number | null;
  /** Cohort close/list ratio (e.g. 0.985) — market softness + hot-market detection. */
  closeListRatio?: number | null;
  /** Upside signals (builders / value-add). All optional. */
  lotSqft?: number | null;
  suitePotential?: boolean | null;
  densityReady?: boolean | null;
}

export interface DealScoreResult {
  /** Final 0–100 score for the ACTIVE persona, or null when no pillar had data. */
  score: number | null;
  grade: DealScoreGrade | null;
  verdict: string;
  /** Pillars present (weighted > 0) for the active persona. */
  components: DealScoreComponent[];
  /** ALL present pillars, persona-independent — lets the UI switch lenses client-side. */
  pillars: DealPillar[];
  /** Which lens this headline is for. */
  persona: DealPersona;
  /** Confidence in the score (drives the chip + gating). */
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  /** Suggested move — null when there's no ask / nothing to anchor. */
  offerBand: OfferBand | null;
  /** All four lenses precomputed, so the UI can switch with no refetch. */
  personaScores: Record<DealPersona, PersonaGrade>;
}

// ── Persona weighting matrix (over the four pillars; renormalized over present) ──────
// Sums need not be 1 — the blend renormalizes over whichever pillars have data.
// Exported so the UI can re-blend / re-render the breakdown per lens with no refetch.
export const PERSONA_WEIGHTS: Record<DealPersona, Record<PillarKey, number>> = {
  smart: { price: 0.55, terms: 0.45, yield: 0.0, upside: 0.0 },
  cashflow: { price: 0.25, terms: 0.2, yield: 0.55, upside: 0.0 },
  flippers: { price: 0.45, terms: 0.4, yield: 0.05, upside: 0.1 },
  builders: { price: 0.35, terms: 0.25, yield: 0.0, upside: 0.4 },
};

const ALL_PERSONAS: DealPersona[] = ["smart", "cashflow", "flippers", "builders"];

// Price weight is scaled by how much we trust the AVM (the comp value behind it).
const CONFIDENCE_MULTIPLIER: Record<"HIGH" | "MEDIUM" | "LOW", number> = {
  HIGH: 1.0,
  MEDIUM: 0.7,
  LOW: 0.4,
};

// ── Scoring anchors: [inputValue, points]. Ascending; piecewise-linear between. ──────
// PRICE: discount % = (avm − list) / avm × 100. Higher = cheaper vs comparable sales.
const PRICE_ANCHORS: Array<[number, number]> = [
  [-15, 0],
  [-5, 25],
  [0, 50],
  [5, 78],
  [10, 92],
  [15, 100],
];

// TERMS · days on market. Longer = more buyer leverage.
const DOM_ANCHORS: Array<[number, number]> = [
  [0, 30],
  [14, 45],
  [30, 65],
  [60, 85],
  [90, 100],
];

// TERMS · price cut % off the original ask. Bigger cut = more motivated seller.
const CUT_ANCHORS: Array<[number, number]> = [
  [0, 35],
  [2, 55],
  [5, 75],
  [10, 92],
  [15, 100],
];

// TERMS · cohort softness = (1 − close/list) × 100. Bigger = market concedes more off ask.
const SOFTNESS_ANCHORS: Array<[number, number]> = [
  [-2, 30], // cohort closes ABOVE ask (hot) → little room
  [0, 45],
  [2, 62],
  [4, 80],
  [7, 100],
];

// TERMS sub-weights (renormalized over whichever signals are present).
const TERMS_W = { dom: 0.4, cut: 0.35, soft: 0.25 };

// UPSIDE · lot size (sqft) for land/redevelopment optionality.
const LOT_ANCHORS: Array<[number, number]> = [
  [2000, 30],
  [4000, 50],
  [6000, 65],
  [10000, 85],
  [20000, 100],
];
const UPSIDE_DENSITY_BONUS = 18;
const UPSIDE_SUITE_BONUS = 12;

// ── Yield: asset-class-relative (static stand-in for the live-cohort percentile) ─────
// Typical extrapolated cap rate (%) by GTA property sub-type. A cap AT baseline scores 50;
// YIELD_SLOPE points are awarded per percentage-point above baseline (and removed below),
// clamped. This replaces the v1 absolute curve that scored every detached SFH ~29.
const ASSET_CLASS_CAP_BASELINE: Record<string, number> = {
  detached: 2.8,
  "semi-detached": 3.2,
  townhouse: 3.4,
  "att/row/townhouse": 3.4,
  "condo townhouse": 3.5,
  "condo apt": 3.6,
  "condo apartment": 3.6,
  duplex: 4.6,
  triplex: 4.8,
  fourplex: 5.0,
  multiplex: 5.0,
};
const DEFAULT_CAP_BASELINE = 3.2;
const YIELD_SLOPE = 22; // points per percentage-point of cap above/below baseline
const YIELD_MIN = 5;
const YIELD_MAX = 100;

// Offer band: max motivation nudge below the likely close (scaled by the Terms score).
const OFFER_MAX_NUDGE = 0.05; // 5%
const OFFER_NUDGE_FLOOR = 40; // Terms ≤ 40 → no nudge
const OFFER_NUDGE_CEIL = 85; // Terms ≥ 85 → full nudge

// ── Grade bands (provisional hand-calibration; replace with the population curve job) ─
// Tuned so a fairly-priced listing (~50 blended) lands a C, not an F.
const GRADE_BANDS: Array<[number, DealScoreGrade, string]> = [
  [80, "A+", "Exceptional — priced well below the signals we track."],
  [70, "A", "Strong deal — multiple metrics favor the buyer."],
  [58, "B", "Solid opportunity with real room to negotiate."],
  [40, "C", "Fairly priced for the area — a normal deal, no red flags."],
  [28, "D", "Priced a bit ahead of the fundamentals."],
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
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

function capBaselineFor(subType: string | null | undefined): number {
  if (!subType) return DEFAULT_CAP_BASELINE;
  return ASSET_CLASS_CAP_BASELINE[subType.trim().toLowerCase()] ?? DEFAULT_CAP_BASELINE;
}

// ── Pillar computation ───────────────────────────────────────────────────────────────
interface Pillar {
  key: PillarKey;
  label: string;
  points: number;
  direction: DealScoreDirection;
  detail: string;
  /** Base weight multiplier (Price scales by AVM confidence; others 1). */
  weightMul: number;
  compValue?: number;
}

function pricePillar(input: DealScoreInput, listPrice: number | null): Pillar | null {
  if (!listPrice || !input.avmEstimate || !(input.avmEstimate.estimatedValue > 0)) return null;
  const est = input.avmEstimate.estimatedValue;
  const discountPct = ((est - listPrice) / est) * 100;
  const points = interpolate(discountPct, PRICE_ANCHORS);
  const absPct = Math.abs(discountPct);
  const conf = `${input.avmEstimate.confidence.toLowerCase()} confidence`;
  // Relative to recent comparable sales — NOT a competing dollar "estimate" (that word is
  // reserved for the headline Estimated Sale Price). Same source feeds the breakdown AND
  // "The Read" catch.
  const detail =
    discountPct >= 0.5
      ? `Listed ${absPct.toFixed(1)}% below comparable sales (${conf})`
      : discountPct <= -0.5
        ? `Listed ${absPct.toFixed(1)}% above comparable sales (${conf})`
        : `Priced in line with comparable sales (${conf})`;
  return {
    key: "price",
    label: "Value vs Comps",
    points,
    direction: directionFor(points),
    detail,
    weightMul: CONFIDENCE_MULTIPLIER[input.avmEstimate.confidence],
    compValue: Math.round(est),
  };
}

function termsPillar(input: DealScoreInput, listPrice: number | null): { pillar: Pillar | null; score: number | null } {
  const parts: Array<{ score: number; w: number }> = [];
  let domDetail = "";
  if (typeof input.domDays === "number" && input.domDays >= 0) {
    const dom = input.domDays;
    parts.push({ score: interpolate(dom, DOM_ANCHORS), w: TERMS_W.dom });
    domDetail =
      dom >= 60
        ? `${dom} days on market — strong buyer leverage`
        : dom >= 30
          ? `${dom} days on market — building leverage`
          : dom >= 14
            ? `${dom} days on market — modest leverage`
            : `${dom} days on market — fresh listing, little leverage`;
  }
  let cutDetail = "";
  if (listPrice && typeof input.originalListPrice === "number" && input.originalListPrice > 0) {
    const orig = input.originalListPrice;
    const cutPct = orig > listPrice ? ((orig - listPrice) / orig) * 100 : 0;
    parts.push({ score: interpolate(cutPct, CUT_ANCHORS), w: TERMS_W.cut });
    if (cutPct >= 0.5) cutDetail = `, reduced ${cutPct.toFixed(1)}% from the ${fmtMoney(orig)} ask`;
  }
  if (typeof input.closeListRatio === "number" && input.closeListRatio > 0) {
    const softPct = (1 - input.closeListRatio) * 100;
    parts.push({ score: interpolate(softPct, SOFTNESS_ANCHORS), w: TERMS_W.soft });
  }
  if (parts.length === 0) return { pillar: null, score: null };
  const wSum = parts.reduce((s, p) => s + p.w, 0);
  const score = parts.reduce((s, p) => s + p.score * p.w, 0) / wSum;
  const detail = (domDetail || "Negotiability based on market softness") + cutDetail;
  return {
    pillar: {
      key: "terms",
      label: "Negotiability",
      points: score,
      direction: directionFor(score),
      detail,
      weightMul: 1,
    },
    score,
  };
}

function yieldPillar(input: DealScoreInput): Pillar | null {
  const cap = input.capRatePct;
  if (typeof cap !== "number" || !(cap > 0)) return null;
  const baseline = capBaselineFor(input.subType);
  const points = clamp(50 + (cap - baseline) * YIELD_SLOPE, YIELD_MIN, YIELD_MAX);
  const rel =
    cap >= baseline + 0.3 ? "above" : cap <= baseline - 0.3 ? "below" : "about";
  const detail = `Cap rate ${cap.toFixed(1)}% — ${rel} typical for this property type (~${baseline.toFixed(1)}%)`;
  return { key: "yield", label: "Yield", points, direction: directionFor(points), detail, weightMul: 1 };
}

function upsidePillar(input: DealScoreInput): Pillar | null {
  const hasLot = typeof input.lotSqft === "number" && input.lotSqft > 0;
  if (!hasLot && !input.suitePotential && !input.densityReady) return null;
  let points = hasLot ? interpolate(input.lotSqft as number, LOT_ANCHORS) : 45;
  if (input.densityReady) points += UPSIDE_DENSITY_BONUS;
  if (input.suitePotential) points += UPSIDE_SUITE_BONUS;
  points = clamp(points, 0, 100);
  const bits: string[] = [];
  if (hasLot) bits.push(`${Math.round(input.lotSqft as number).toLocaleString("en-CA")} sqft lot`);
  if (input.densityReady) bits.push("surplus parking");
  if (input.suitePotential) bits.push("suite potential");
  return {
    key: "upside",
    label: "Upside",
    points,
    direction: directionFor(points),
    detail: bits.length ? bits.join(" · ") : "Redevelopment / value-add optionality",
    weightMul: 1,
  };
}

/** Blend present pillars for one persona; renormalize weights over what's present. */
function blendForPersona(
  pillars: Pillar[],
  persona: DealPersona
): { score: number | null; weightByKey: Map<PillarKey, number> } {
  const weights = PERSONA_WEIGHTS[persona];
  const weightByKey = new Map<PillarKey, number>();
  let weighted = 0;
  let totalW = 0;
  for (const p of pillars) {
    const w = weights[p.key] * p.weightMul;
    if (w <= 0) continue;
    weightByKey.set(p.key, w);
    weighted += p.points * w;
    totalW += w;
  }
  if (totalW <= 0) return { score: null, weightByKey };
  return { score: weighted / totalW, weightByKey };
}

function confidenceFor(pillars: Pillar[], avmConf: "HIGH" | "MEDIUM" | "LOW" | null): DealScoreResult["confidence"] {
  if (pillars.length === 0) return null;
  const present = pillars.length;
  if (avmConf === "HIGH" && present >= 2) return "HIGH";
  if (avmConf === "LOW" || present <= 1) return "LOW";
  return "MEDIUM";
}

function computeOfferBand(
  input: DealScoreInput,
  listPrice: number | null,
  termsScore: number | null
): OfferBand | null {
  if (!listPrice || listPrice <= 0) return null;
  const avm = input.avmEstimate && input.avmEstimate.estimatedValue > 0 ? input.avmEstimate.estimatedValue : null;
  const expected = typeof input.expectedSalePrice === "number" && input.expectedSalePrice > 0 ? input.expectedSalePrice : null;
  if (avm === null && expected === null) return null;

  const likelyClose = expected ?? (avm as number);
  const fairValue = avm ?? likelyClose;
  const ts = termsScore ?? 45;
  const motivation = clamp((ts - OFFER_NUDGE_FLOOR) / (OFFER_NUDGE_CEIL - OFFER_NUDGE_FLOOR), 0, 1) * OFFER_MAX_NUDGE;
  const aggressive = Math.round(Math.min(fairValue, likelyClose) * (1 - motivation));
  const ceiling = Math.round(Math.max(fairValue, likelyClose));
  const hotMarket = typeof input.closeListRatio === "number" && input.closeListRatio > 1.0;
  // Provenance: the high-confidence list-anchored Expected Sale, or the AVM fallback.
  // When AVM-based there is no close-rate signal, so the copy must NOT claim comps support.
  const basis: "expected-sale" | "avm" = expected !== null ? "expected-sale" : "avm";

  const note = hotMarket
    ? `Homes here close above ask — expect to compete near ${fmtMoney(likelyClose)}.`
    : basis === "expected-sale"
      ? `Comparable closings support ${fmtMoney(Math.min(aggressive, likelyClose))}–${fmtMoney(likelyClose)}; overpaying above ~${fmtMoney(ceiling)}.`
      : `Our comparable-sales estimate (no recent close-rate data) — treat ${fmtMoney(Math.min(aggressive, likelyClose))}–${fmtMoney(likelyClose)} as indicative; above ~${fmtMoney(ceiling)} looks rich.`;

  return { aggressive: Math.min(aggressive, likelyClose), likelyClose, ceiling, note, hotMarket, basis };
}

/**
 * Compute the Deal Score from already-derived listing metrics. Pure & deterministic:
 * identical inputs + persona always yield an identical result.
 *
 * @param persona which lens the headline `score`/`grade`/`components` are for (default
 *   "smart" = the app's default Homebuyer persona). All four lenses are always returned
 *   in `personaScores` so the UI can switch without recomputing.
 */
export function computeDealScore(input: DealScoreInput, persona: DealPersona = "smart"): DealScoreResult {
  const listPrice =
    typeof input.listPrice === "number" && input.listPrice > 0 ? input.listPrice : null;

  // Build every pillar once; personas just re-weight them.
  const price = pricePillar(input, listPrice);
  const { pillar: terms, score: termsScore } = termsPillar(input, listPrice);
  const yld = yieldPillar(input);
  const upside = upsidePillar(input);
  const pillars: Pillar[] = [price, terms, yld, upside].filter((p): p is Pillar => p !== null);

  const offerBand = computeOfferBand(input, listPrice, termsScore);
  const confidence = confidenceFor(pillars, input.avmEstimate?.confidence ?? null);

  // Persona-independent pillar payload (for client-side lens switching).
  const pillarsPublic: DealPillar[] = pillars.map((p) => ({
    key: p.key,
    label: p.label,
    points: p.points,
    direction: p.direction,
    detail: p.detail,
    ...(p.compValue !== undefined ? { compValue: p.compValue } : {}),
  }));

  // All four lenses (for the switcher).
  const personaScores = {} as Record<DealPersona, PersonaGrade>;
  for (const p of ALL_PERSONAS) {
    const { score } = blendForPersona(pillars, p);
    if (score === null) {
      personaScores[p] = { score: null, grade: null, verdict: "Not enough data to score this listing." };
    } else {
      const rounded = Math.round(score);
      const { grade, verdict } = gradeFor(rounded);
      personaScores[p] = { score: rounded, grade, verdict };
    }
  }

  // Active persona — its blend + the pillars it actually used (weighted > 0 and present).
  const { score: activeScore, weightByKey } = blendForPersona(pillars, persona);
  const components: DealScoreComponent[] = pillars
    .filter((p) => weightByKey.has(p.key))
    .map((p) => ({
      key: p.key,
      label: p.label,
      points: p.points,
      weight: weightByKey.get(p.key) as number,
      direction: p.direction,
      detail: p.detail,
      ...(p.compValue !== undefined ? { compValue: p.compValue } : {}),
    }));

  if (activeScore === null) {
    return {
      score: null,
      grade: null,
      verdict: "Not enough data to score this listing.",
      components,
      pillars: pillarsPublic,
      persona,
      confidence,
      offerBand,
      personaScores,
    };
  }

  const score = Math.round(activeScore);
  const { grade, verdict } = gradeFor(score);
  return { score, grade, verdict, components, pillars: pillarsPublic, persona, confidence, offerBand, personaScores };
}

/** A fully-typed "no score" result — for the VOW-gated anon path (the score embeds the AVM). */
export const EMPTY_DEAL_SCORE: DealScoreResult = {
  score: null,
  grade: null,
  verdict: "",
  components: [],
  pillars: [],
  persona: "smart",
  confidence: null,
  offerBand: null,
  personaScores: {
    smart: { score: null, grade: null, verdict: "" },
    cashflow: { score: null, grade: null, verdict: "" },
    flippers: { score: null, grade: null, verdict: "" },
    builders: { score: null, grade: null, verdict: "" },
  },
};

export default computeDealScore;
