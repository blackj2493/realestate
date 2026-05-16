/**
 * AVM Types — Anchor and Adjust Automated Valuation Model
 * 
 * Terminology: The word "AI" is banned from all code, variable names,
 * function names, API responses, and comments.
 */

export interface AVMInput {
  cityRegion: string;
  propertySubType: string;
  bedroomsAboveGrade: number;
  bathroomsTotalInteger: number;
  parkingTotal: number;
  interiorTier: number;    // 1-5
  exteriorTier: number;     // 1-5
  basementTier: number;     // 1-9
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
 * Coefficient engine threshold (R² >= 0.50)
 */
export const COEFFICIENT_ENGINE_THRESHOLD = 0.50;
export const HIGH_CONFIDENCE_THRESHOLD = 0.70;