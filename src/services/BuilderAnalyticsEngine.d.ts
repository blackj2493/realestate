/**
 * Type declarations for BuilderAnalyticsEngine.js (CommonJS).
 * Mirrors the object returned by processBuilderMetrics so consumers get
 * field-level typing instead of the bare `Object` inferred from JSDoc.
 */

export interface BuilderMetrics {
  lot_width_ft: number;
  lot_depth_ft: number;
  lot_area_sqft: number;
  lot_confidence: string;
  infrastructure_flag: string;
  is_covered_land: boolean;
  severance_candidate: boolean;
  density_play: string;
  price_per_sqft: number | null;

  // Builder metadata aliases
  pricePerSqFt: number | null;
  lotDimensions: {
    width: number;
    depth: number;
    areaSqFt: number;
    acres: number;
  };
  sewerStatus: string;
  waterStatus: string;
  zoningDesignation: string;
  isCoveredLand: boolean;
  multiplexByRight: boolean;
  aduEligible: boolean;
  gardenSuiteEligible: boolean;
}

export interface BuilderBatchResult {
  processed: BuilderMetrics[];
  failed: Array<{ listing: string; reason: string }>;
}

export function processBuilderMetrics(rawJson: Record<string, unknown>): BuilderMetrics;
export function processBatch(listings: Array<Record<string, unknown>>): BuilderBatchResult;
export function serializeForTypesense(processed: BuilderMetrics): Record<string, unknown>;
