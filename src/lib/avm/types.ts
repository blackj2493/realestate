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
  /** Canonical type for matrix/audit lookups (normalizePropertySubType output). */
  propertySubType: string;
  /** Verbatim listing PropertySubType — used to pool raw_vow_sold anchor variants. */
  rawPropertySubType: string;
  buildingAreaTotal: number | null;
  lotWidth: number | null;
  bedroomsAboveGrade: number | null;
  bathroomsTotalInteger: number | null;
  parkingTotal: number | null;
  interiorTier: number; // 1-5
  exteriorTier: number; // 1-5
  basementTier: number; // 1-9
}

export interface AVMResult {
  estimatedValue: number;
  anchorPrice: number;
  totalAdjustmentPct: number;
  engineMode: 'COEFFICIENT_ADJUSTED' | 'ANCHOR_ONLY';
  r2Score: number | null;
  breakdown: AVMAdjustmentBreakdown;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
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
 * Standardized log-space formula bounds and anchor requirements.
 *   z_i      = clamp((x_i − mean_i) / std_i, ±Z_CLAMP)
 *   total    = clamp(Σ beta_i · z_i, ±ADJ_CLAMP)
 *   estimate = anchor × exp(total)
 * MIN_ANCHOR_COMPS: minimum 90-day comps before trusting the live median anchor;
 * below it we fall back to the audit Base_Price.
 */
export const Z_CLAMP = 3;
export const ADJ_CLAMP = 0.4;
export const MIN_ANCHOR_COMPS = 5;
