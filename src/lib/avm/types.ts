/**
 * AVM Types — Anchor and Adjust Automated Valuation Model
 *
 * Terminology: The word "AI" is banned from all code, variable names,
 * function names, API responses, and comments.
 *
 * Counts and the two continuous features are `number | null`: null means the
 * field is genuinely ABSENT on the listing and the calculator skips it (which
 * matches the training pipeline imputing a missing value with the feature mean →
 * standardizes to z=0). A real `0` (e.g. 0 parking) is kept and standardized.
 */

export interface AVMInput {
  cityRegion: string;
  /** Municipality (raw_vow_sold.city / payload.City) — used for city-level
   * trend de-staling. Optional: when missing, anchor falls back to using
   * cityRegion as the trend-lookup group. */
  city: string | null;
  /** Canonical type for matrix/audit lookups (normalizePropertySubType output). */
  propertySubType: string;
  /** Verbatim listing PropertySubType — used to pool raw_vow_sold anchor variants. */
  rawPropertySubType: string;
  buildingAreaTotal: number | null;
  lotWidth: number | null;
  /** Lot depth (ft). Used ONLY for peer similarity in the comp-grid (not a trained
   * coefficient), so adding it never changes the normal-path estimate. Optional. */
  lotDepth?: number | null;
  bedroomsAboveGrade: number | null;
  bathroomsTotalInteger: number | null;
  parkingTotal: number | null;
  interiorTier: number; // 1-5
  exteriorTier: number; // 1-5
  basementTier: number; // 1-9
}

/** Where the anchor's level estimate came from — surfaced in the UI basis line. */
export type AnchorBasis =
  | 'local'   // recent local comps drove the level (low shrinkage to prior)
  | 'blend'   // local comps + de-staled prior shrunk together
  | 'prior'   // no usable local comps; prior (g(t₀)+δ_c) carried the level
  | 'parent'  // community offset missing; parent city × sub-type level used
  | 'peer'    // saturating outlier priced by the peer comp-grid (homes like it)
  | 'floor'   // saturating outlier, too few peers — clamped number as a neighbourhood FLOOR
  | 'none';   // truly nothing — render "estimate unavailable"

export interface AVMResult {
  estimatedValue: number;
  anchorPrice: number;
  totalAdjustmentPct: number;
  engineMode: 'COEFFICIENT_ADJUSTED' | 'ANCHOR_ONLY';
  r2Score: number | null;
  breakdown: AVMAdjustmentBreakdown;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';

  /** Number of raw recent comps consulted (pre-Huber weighting). */
  comps: number;
  /** Kish-effective sample size (Σw)² / Σw² after recency + robust weights. */
  nEff: number;
  /** Which leg of the anchor pipeline produced the level. */
  basis: AnchorBasis;
  /** Lower bound of the 1-SD predictive band on price (= exp(level - SD) × feature multiplier). */
  lowBand: number;
  /** Upper bound of the 1-SD predictive band on price. */
  highBand: number;
  /** Predictive SD in log-space (combined local + prior variance). */
  predictiveSD: number;
}

export interface AVMAdjustmentBreakdown {
  buildingAreaAdjustment: number;
  lotWidthAdjustment: number;
  bedroomsAdjustment: number;
  bathroomsAdjustment: number;
  parkingAdjustment: number;
  interiorAdjustment: number;
  exteriorAdjustment: number;
  basementAdjustment: number;
}

/**
 * Engine mode constants
 */
export const ENGINE_MODE_COEFFICIENT_ADJUSTED = 'COEFFICIENT_ADJUSTED' as const;
export const ENGINE_MODE_ANCHOR_ONLY = 'ANCHOR_ONLY' as const;

/**
 * Confidence level constants
 */
export const CONFIDENCE_HIGH = 'HIGH' as const;
export const CONFIDENCE_MEDIUM = 'MEDIUM' as const;
export const CONFIDENCE_LOW = 'LOW' as const;

/**
 * Coefficient engine gate (R² >= 0.50) and high-confidence threshold (R² >= 0.70).
 */
export const COEFFICIENT_ENGINE_THRESHOLD = 0.5;
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Standardized log-space formula bounds.
 *   z_i      = clamp((x_i − mean_i) / std_i, ±Z_CLAMP)
 *   total    = clamp(Σ beta_i · z_i, ±ADJ_CLAMP)
 *   estimate = anchor × exp(total)
 */
export const Z_CLAMP = 3;
export const ADJ_CLAMP = 0.4;

/**
 * Anchor-pipeline tuning. Defaults shipped Phase 1; Phase 2 will fit them via
 * cross-validation against raw_vow_sold (see plan concurrent-prancing-owl).
 *
 *   H_DAYS    — exponential recency half-life on comp weights (~4 mo).
 *   TAU2      — between-community variance in log-space (prior strength).
 *   SIGMA2    — residual variance per comp (Kish-effective denominator).
 *   COMP_WINDOW_MO — trailing months of comps to consider local.
 *   HUBER_K   — Huber threshold (std-units) on the comp ℓ residual.
 *   BAND_*    — relative half-width thresholds for confidence; above BAND_LOW,
 *               suppress the estimate ("range too wide to publish").
 */
export const H_DAYS = 120;
export const TAU2 = 0.02;
export const SIGMA2 = 0.04;
export const COMP_WINDOW_MO = 12;
export const HUBER_K = 1.345;
export const BAND_HIGH = 0.08;
export const BAND_MED = 0.15;
export const BAND_LOW = 0.25;

/**
 * Peer comp-grid tuning (atypical / high-end homes). Fires only when the standard
 * coefficient adjustment saturates the ±ADJ_CLAMP clamp — see calculator.isSaturating.
 * Stays independent of list price (CLAUDE.md §2).
 *
 *   MIN_PEER_NEFF       — effective peers a geography rung must clear to anchor on
 *                         peers; below it, escalate, then fall back to a FLOOR.
 *   MIN_PEERS_FOR_HIGH  — effective peers required before a peer estimate may be
 *                         labelled HIGH confidence (a tight band on 3 comps isn't HIGH).
 *   BW_*                — Gaussian similarity bandwidths (std-units) on the size
 *                         proxies the comps actually carry: beds, baths, log-lot-area.
 * Phase-1 defaults; tune against raw_vow_sold like the anchor-pipeline constants.
 */
export const MIN_PEER_NEFF = 6;
export const MIN_PEERS_FOR_HIGH = 8;
export const BW_BEDS = 1;
export const BW_BATHS = 1;
export const BW_LOT = 0.5;
