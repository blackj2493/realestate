/**
 * Builder Property Type Definitions
 * Interfaces, types, and helper functions for land/severe analysis
 */

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Lot dimensional data for land properties
 */
export interface LotDimensions {
  width: number;        // in feet
  depth: number;        // in feet
  areaSqFt: number;     // calculated as width × depth
  acres: number;        // calculated as areaSqFt / 43,560, rounded to 2 decimals
}

// ============================================================================
// Union Types
// ============================================================================

/**
 * Utility connection status for sewer and water
 */
export type UtilityStatus = 'municipal' | 'septic' | 'well' | 'none' | 'unknown';

/**
 * Density potential based on zoning and lot size
 */
export type DensityPotential = 'none' | 'low' | 'medium' | 'high';

// ============================================================================
// Main Metadata Interface
// ============================================================================

/**
 * Builder property metadata for land analysis and filtering
 */
export interface BuilderPropertyMetadata {
  // Column data
  pricePerSqFt: number | null;           // Purchase price divided by gross land area in sqft
  lotDimensions: LotDimensions | null;   // Width, depth, area in sqft, and acres
  sewerStatus: UtilityStatus;            // Municipal sewer, septic, or none
  waterStatus: UtilityStatus;            // Municipal water, well, or none
  zoningDesignation: string;             // Current zoning code (e.g., "R1", "R2", "RM")
  severanceCandidate: boolean;            // True if lot can be legally severed
  densityPlayPotential: DensityPotential; // None/Low/Medium/High based on zoning and lot size
  
  // Filter fields
  isCoveredLand: boolean;                // True if property has existing structure
  multiplexByRight: boolean;             // True if zoning allows 2+ units without variance
  
  // Badge flags
  aduEligible: boolean;                  // True if ADU (Accessory Dwelling Unit) is permitted
  gardenSuiteEligible: boolean;           // True if garden suite is permitted under zoning
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Formats price per square foot as a display string
 * @param price - The purchase price
 * @param sqFt - The lot area in square feet
 * @returns Formatted string like "$12.45 /sqft" or "N/A" if inputs are invalid
 */
export function formatPricePerSqFt(price: number, sqFt: number): string {
  if (!price || !sqFt || price <= 0 || sqFt <= 0) {
    return 'N/A';
  }
  const pricePerSqFt = price / sqFt;
  return `$${pricePerSqFt.toFixed(2)} /sqft`;
}

/**
 * Formats lot dimensions for display
 * @param dimensions - LotDimensions object with width, depth, areaSqFt, acres
 * @returns Formatted string: "50 × 150 ft" if acres < 0.25, otherwise "0.45 ac"
 */
export function formatLotDimensions(dimensions: LotDimensions): string {
  if (!dimensions || dimensions.acres === undefined) {
    return 'N/A';
  }
  
  if (dimensions.acres < 0.25) {
    return `${dimensions.width} × ${dimensions.depth} ft`;
  }
  
  return `${dimensions.acres.toFixed(2)} ac`;
}

/**
 * Formats utility status for display
 * @param status - UtilityStatus value
 * @returns Display labels: "MU" for municipal, "SE" for septic, "WL" for well, "N/A" for unknown/none
 */
export function formatUtilityStatus(status: UtilityStatus): string {
  switch (status) {
    case 'municipal':
      return 'MU';
    case 'septic':
      return 'SE';
    case 'well':
      return 'WL';
    case 'none':
    case 'unknown':
    default:
      return 'N/A';
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to validate BuilderPropertyMetadata structure
 * @param obj - Any object to validate
 * @returns True if object has all required BuilderPropertyMetadata fields with correct types
 */
export function isBuilderPropertyMetadata(obj: unknown): obj is BuilderPropertyMetadata {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const o = obj as Record<string, unknown>;

  // Check primitive types
  if (typeof o.pricePerSqFt !== 'number' && o.pricePerSqFt !== null) return false;
  if (typeof o.lotDimensions !== 'object' && o.lotDimensions !== null) return false;
  if (typeof o.sewerStatus !== 'string') return false;
  if (typeof o.waterStatus !== 'string') return false;
  if (typeof o.zoningDesignation !== 'string') return false;
  if (typeof o.severanceCandidate !== 'boolean') return false;
  if (typeof o.densityPlayPotential !== 'string') return false;
  if (typeof o.isCoveredLand !== 'boolean') return false;
  if (typeof o.multiplexByRight !== 'boolean') return false;
  if (typeof o.aduEligible !== 'boolean') return false;
  if (typeof o.gardenSuiteEligible !== 'boolean') return false;

  // Validate UtilityStatus values
  const validUtilityStatuses = ['municipal', 'septic', 'well', 'none', 'unknown'];
  if (!validUtilityStatuses.includes(o.sewerStatus as string)) return false;
  if (!validUtilityStatuses.includes(o.waterStatus as string)) return false;

  // Validate DensityPotential value
  const validDensityPotentials = ['none', 'low', 'medium', 'high'];
  if (!validDensityPotentials.includes(o.densityPlayPotential as string)) return false;

  // Validate LotDimensions if present
  if (o.lotDimensions !== null) {
    const ld = o.lotDimensions as Record<string, unknown>;
    if (typeof ld.width !== 'number' || typeof ld.depth !== 'number') return false;
    if (typeof ld.areaSqFt !== 'number' 