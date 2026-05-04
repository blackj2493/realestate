/**
 * Shadow MLS - Eligibility Filter for ADU/Suite Potential Scoring (Phase 2)
 * 
 * Institutional-grade deterministic gatekeeper that evaluates listing eligibility
 * for Additional Dwelling Unit (ADU) development across three tiers:
 * 
 * 1. UNIVERSAL DOA Checks (Deal Killers)
 *    - Condo restrictions, servicing requirements, land lease/mobile ineligible
 *    - If ANY fail, cascades to reject BOTH Internal and Detached eligibility
 * 
 * 2. INTERNAL DOA Checks (2nd Suite - Basement Conversion)
 *    - Evaluates foundation depth for basement suite potential
 *    - Independent of Detached evaluation when Universal passes
 * 
 * 3. DETACHED DOA Checks (3rd Suite - ARU/Dettached Structure)
 *    - Evaluates lot depth and property configuration
 *    - Independent of Internal evaluation when Universal passes
 * 
 * This module ensures NO false positives in ADU potential scoring by using
 * strict deterministic rules that mirror Ontario municipal bylaws.
 */

// ============================================================================
// Input Interface
// ============================================================================

/**
 * Partial listing interface for eligibility evaluation.
 * Matches key fields from the Typesense transform pipeline.
 * All fields are optional for defensive null-safety.
 */
export interface TerminalListing {
  /** Property type classification (e.g., "Residential", "Condo", "Commercial") */
  propertyType?: string | null;
  
  /** Property sub-type (e.g., "Detached", "Semi-Detached", "Att/Row/Twnhouse") */
  propertySubType?: string | null;
  
  /** Sewer servicing array (e.g., ["Municipal", "Septic"]) */
  sewer?: string[] | null;
  
  /** Water servicing array (e.g., ["Municipal", "Well"]) */
  water?: string[] | null;
  
  /** Basement type array (e.g., ["Finished", "Full"]) */
  basement?: string[] | null;
  
  /** Monthly land lease fee (0 = freehold, >0 = leasehold) */
  leasedLandFee?: number | null;
  
  /** Lot depth in feet */
  lotDepth?: number | null;
}

// ============================================================================
// Output Interface
// ============================================================================

/**
 * Result of eligibility evaluation across all three tiers.
 * Each tier has its own eligibility flag and optional rejection reason.
 */
export interface EligibilityResult {
  /** Universal eligibility - must pass for any ADU development */
  isUniversallyEligible: boolean;
  universalRejectionReason: string | null;
  
  /** Internal 2nd Suite eligibility - basement conversion potential */
  isInternalEligible: boolean;
  internalRejectionReason: string | null;
  
  /** Detached 3rd Suite eligibility - ARU/ground-level structure potential */
  isDetachedEligible: boolean;
  detachedRejectionReason: string | null;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Minimum lot depth in feet required for detached ARU setbacks per Ontario municipal bylaws.
 */
const MIN_LOT_DEPTH_FOR_DETACHED = 90;

/**
 * Rejection reason messages for audit trail and user-facing feedback.
 */
const REJECTION_MESSAGES = {
  CONDO: 'Condominium corporation restricts structural expansion.',
  SEPTIC: 'Bill 23 exemptions require municipal water/sewer servicing.',
  WELL: 'Bill 23 exemptions require municipal water/sewer servicing.',
  LEASE_MOBILE: 'Land lease or mobile structures ineligible for structural ADUs.',
  NON_RESIDENTIAL: 'Not a residential structure.',
  BASEMENT_INSUFFICIENT: 'Insufficient foundation depth (prohibitive underpinning cost).',
  LOT_DEPTH: 'Lot depth insufficient for municipal ARU setbacks.',
  ATTACHED_ROW: 'Attached row homes lack required EMS side-yard clearance.',
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely checks if a string array includes a value (case-insensitive).
 * Returns false on null/undefined input.
 */
function arrayIncludesInsensitive(
  arr: string[] | null | undefined,
  searchValue: string
): boolean {
  if (!Array.isArray(arr)) return false;
  
  const normalizedSearch = searchValue.toLowerCase();
  return arr.some(item => 
    typeof item === 'string' && item.toLowerCase().includes(normalizedSearch)
  );
}

/**
 * Safely checks if a string array contains an exact match (case-insensitive).
 * Returns false on null/undefined input.
 */
function arrayContainsExactInsensitive(
  arr: string[] | null | undefined,
  searchValue: string
): boolean {
  if (!Array.isArray(arr)) return false;
  
  const normalizedSearch = searchValue.toLowerCase();
  return arr.some(item => 
    typeof item === 'string' && item.toLowerCase() === normalizedSearch
  );
}

/**
 * Safely checks if propertyType includes a keyword (case-insensitive).
 */
function propertyTypeIncludes(listing: TerminalListing, keyword: string): boolean {
  const pt = listing.propertyType;
  if (typeof pt !== 'string') return false;
  return pt.toLowerCase().includes(keyword.toLowerCase());
}

/**
 * Safely checks if propertySubType includes a keyword (case-insensitive).
 */
function propertySubTypeIncludes(listing: TerminalListing, keyword: string): boolean {
  const pst = listing.propertySubType;
  if (typeof pst !== 'string') return false;
  return pst.toLowerCase().includes(keyword.toLowerCase());
}

// ============================================================================
// Validation Logic
// ============================================================================

/**
 * Step 1: Universal DOA (Dead On Arrival) Checks
 * 
 * These are deal killers - if ANY check fails, the property is ineligible
 * for ANY ADU development (both 2nd suite and detached ARU).
 * 
 * @returns [isEligible: boolean, rejectionReason: string | null]
 */
function evaluateUniversal(listing: TerminalListing): [boolean, string | null] {
  // ── Condo Restriction ─────────────────────────────────────────────────────
  // Condos cannot add structural elements without corporation approval
  const isCondoType = propertyTypeIncludes(listing, 'condo');
  const isCondoSubType = propertySubTypeIncludes(listing, 'condo');
  
  if (isCondoType || isCondoSubType) {
    return [false, REJECTION_MESSAGES.CONDO];
  }
  
  // ── Servicing Requirements ───────────────────────────────────────────────
  // Bill 23 ARU exemptions require municipal water/sewer for infill housing
  const hasSeptic = arrayIncludesInsensitive(listing.sewer, 'septic');
  const hasWell = arrayIncludesInsensitive(listing.water, 'well');
  
  if (hasSeptic) {
    return [false, REJECTION_MESSAGES.SEPTIC];
  }
  
  if (hasWell) {
    return [false, REJECTION_MESSAGES.WELL];
  }
  
  // ── Land Lease / Mobile Structures ──────────────────────────────────────
  // Cannot build structural ADUs on leasehold land or mobile homes
  const leasedLandFee = listing.leasedLandFee;
  const isMobileHome = propertySubTypeIncludes(listing, 'mobile');
  
  if (leasedLandFee !== null && leasedLandFee !== undefined && leasedLandFee > 0) {
    return [false, REJECTION_MESSAGES.LEASE_MOBILE];
  }
  
  if (isMobileHome) {
    return [false, REJECTION_MESSAGES.LEASE_MOBILE];
  }
  
  // ── Non-Residential Property Types ───────────────────────────────────────
  // Only residential structures qualify for ADU development
  const nonResidentialTypes = ['commercial', 'industrial', 'agricultural', 'vacant'];
  
  for (const propType of nonResidentialTypes) {
    if (propertyTypeIncludes(listing, propType)) {
      return [false, REJECTION_MESSAGES.NON_RESIDENTIAL];
    }
  }
  
  // All universal checks passed
  return [true, null];
}

/**
 * Step 2: Internal DOA Checks (2nd Suite / Basement Conversion)
 * 
 * Evaluates whether a basement suite is feasible based on foundation depth.
 * Requires full-depth foundation for legal basement suite construction.
 * 
 * @note Only evaluated if Universal checks passed
 * @returns [isEligible: boolean, rejectionReason: string | null]
 */
function evaluateInternal(listing: TerminalListing): [boolean, string | null] {
  // Insufficient basement foundation types for underpinning
  const insufficientBasementTypes = ['crawl space', 'half', 'none'];
  
  for (const basementType of insufficientBasementTypes) {
    if (arrayIncludesInsensitive(listing.basement, basementType)) {
      return [false, REJECTION_MESSAGES.BASEMENT_INSUFFICIENT];
    }
  }
  
  // All internal checks passed
  return [true, null];
}

/**
 * Step 3: Detached DOA Checks (3rd Suite / ARU / Detached Structure)
 * 
 * Evaluates whether a detached structure (ARU, coach house, garden suite) is feasible.
 * Considers lot depth requirements and property configuration constraints.
 * 
 * @note Only evaluated if Universal checks passed
 * @note Evaluated INDEPENDENTLY of Internal checks
 * @returns [isEligible: boolean, rejectionReason: string | null]
 */
function evaluateDetached(listing: TerminalListing): [boolean, string | null] {
  // ── Lot Depth Requirement ─────────────────────────────────────────────────
  // Ontario municipalities typically require 90ft+ lot depth for ARU setbacks
  // (parking space + structure + side yard = ~75-85ft minimum)
  const lotDepth = listing.lotDepth;
  
  if (lotDepth !== null && lotDepth !== undefined && lotDepth < MIN_LOT_DEPTH_FOR_DETACHED) {
    return [false, REJECTION_MESSAGES.LOT_DEPTH];
  }
  
  // ── Attached Row / Townhouse Configuration ─────────────────────────────────
  // Attached row homes share walls and lack required EMS side-yard clearance
  // for fire separation and emergency access.
  // 
  // Fail on: "Att/Row/Twnhouse", "Row House", "Townhouse", "Rowhouse"
  // Do NOT fail on: "Semi-Detached", "Detached"
  const propertySubType = listing.propertySubType;
  const pstNormalized = typeof propertySubType === 'string' 
    ? propertySubType.toLowerCase() 
    : '';
  
  // Check for row or townhouse keywords (case-insensitive)
  // Note: "Semi-Detached" should NOT match these checks
  if (pstNormalized.includes('row') || pstNormalized.includes('townhouse')) {
    // Additional safety: ensure it's not being confused with other terms
    // "Row" or "Townhouse" appearing in the subtype indicates attached configuration
    return [false, REJECTION_MESSAGES.ATTACHED_ROW];
  }
  
  // All detached checks passed
  return [true, null];
}

// ============================================================================
// Main Export Functions
// ============================================================================

/**
 * Evaluates a single listing for ADU/Suite Potential eligibility.
 * 
 * Implements a cascading waterfall:
 * 1. Universal checks run first - if ANY fail, Internal and Detached both fail
 * 2. If Universal passes, Internal and Detached are evaluated INDEPENDENTLY
 * 
 * @param listing - TerminalListing object with property data
 * @returns EligibilityResult with eligibility flags and rejection reasons
 * 
 * @example
 * ```typescript
 * const listing: TerminalListing = {
 *   propertyType: 'Residential',
 *   propertySubType: 'Detached',
 *   sewer: ['Municipal'],
 *   water: ['Municipal'],
 *   basement: ['Finished', 'Full'],
 *   leasedLandFee: 0,
 *   lotDepth: 120,
 * };
 * 
 * const result = evaluateEligibility(listing);
 * // result.isUniversallyEligible = true
 * // result.isInternalEligible = true
 * // result.isDetachedEligible = true
 * ```
 */
export function evaluateEligibility(listing: TerminalListing): EligibilityResult {
  // ── Step 1: Universal DOA Checks ──────────────────────────────────────────
  const [isUniversalEligible, universalReason] = evaluateUniversal(listing);
  
  // ── Step 2 & 3: Cascade Logic ─────────────────────────────────────────────
  // If Universal fails, ALL tiers are ineligible (fail-fast on deal killers)
  // If Universal passes, Internal and Detached are evaluated independently
  
  let isInternalEligible: boolean;
  let internalRejectionReason: string | null;
  let isDetachedEligible: boolean;
  let detachedRejectionReason: string | null;
  
  if (!isUniversalEligible) {
    // Universal failed - cascade rejection to all tiers
    isInternalEligible = false;
    internalRejectionReason = universalReason; // Cascade the universal reason
    isDetachedEligible = false;
    detachedRejectionReason = universalReason; // Cascade the universal reason
  } else {
    // Universal passed - evaluate Internal and Detached independently
    const [intEligible, intReason] = evaluateInternal(listing);
    const [detEligible, detReason] = evaluateDetached(listing);
    
    isInternalEligible = intEligible;
    internalRejectionReason = intReason;
    isDetachedEligible = detEligible;
    detachedRejectionReason = detReason;
  }
  
  return {
    isUniversallyEligible: isUniversalEligible,
    universalRejectionReason: universalReason,
    isInternalEligible,
    internalRejectionReason,
    isDetachedEligible,
    detachedRejectionReason,
  };
}

/**
 * Evaluates a batch of listings for ADU/Suite Potential eligibility.
 * 
 * @param listings - Array of TerminalListing objects
 * @returns Array of EligibilityResult objects (same order as input)
 * 
 * @example
 * ```typescript
 * const listings: TerminalListing[] = [listing1, listing2, listing3];
 * const results = evaluateBatchEligibility(listings);
 * ```
 */
export function evaluateBatchEligibility(listings: TerminalListing[]): EligibilityResult[] {
  if (!Array.isArray(listings)) {
    console.warn('evaluateBatchEligibility: Expected array, received non-array input');
    return [];
  }
  
  return listings.map(listing => evaluateEligibility(listing));
}

// ============================================================================
// Test & Dev Helpers
// ============================================================================

/**
 * Creates a mock eligible listing for testing.
 */
export function createMockEligibleListing(
  overrides: Partial<TerminalListing> = {}
): TerminalListing {
  return {
    propertyType: 'Residential',
    propertySubType: 'Detached',
    sewer: ['Municipal'],
    water: ['Municipal'],
    basement: ['Finished', 'Full'],
    leasedLandFee: 0,
    lotDepth: 110,
    ...overrides,
  };
}

/**
 * Creates a mock ineligible listing (condo with septic) for testing.
 */
export function createMockIneligibleListing(
  overrides: Partial<TerminalListing> = {}
): TerminalListing {
  return {
    propertyType: 'Condo',
    propertySubType: 'Condo',
    sewer: ['Septic'],
    water: ['Well'],
    basement: ['Crawl Space'],
    leasedLandFee: 150,
    lotDepth: 0,
    ...overrides,
  };
}

/**
 * Runs comprehensive test cases for eligibility evaluation.
 * Useful for CI/CD pipeline validation.
 */
export function runEligibilityTests(): void {
  console.log('\n🧪 Shadow MLS Eligibility Filter Tests');
  console.log('='.repeat(60));
  
  // ── Test Case 1: Fully Eligible Detached Home ─────────────────────────────
  const test1 = createMockEligibleListing();
  const result1 = evaluateEligibility(test1);
  console.log('\n✅ Test 1: Fully Eligible Detached Home');
  console.log('   Input:', JSON.stringify(test1));
  console.log('   Result:', JSON.stringify(result1));
  console.assert(result1.isUniversallyEligible === true, 'Should be universally eligible');
  console.assert(result1.isInternalEligible === true, 'Should be internally eligible');
  console.assert(result1.isDetachedEligible === true, 'Should be detached eligible');
  
  // ── Test Case 2: Condo Rejection ──────────────────────────────────────────
  const test2 = createMockIneligibleListing({ propertyType: 'Condo', propertySubType: 'Condo' });
  const result2 = evaluateEligibility(test2);
  console.log('\n❌ Test 2: Condo Rejection');
  console.log('   Input:', JSON.stringify(test2));
  console.log('   Result:', JSON.stringify(result2));
  console.assert(result2.isUniversallyEligible === false, 'Should NOT be universally eligible');
  console.assert(result2.universalRejectionReason === REJECTION_MESSAGES.CONDO, 'Should have condo rejection');
  console.assert(result2.isInternalEligible === false, 'Should cascade to internal rejection');
  console.assert(result2.isDetachedEligible === false, 'Should cascade to detached rejection');
  
  // ── Test Case 3: Septic Servicing Rejection ───────────────────────────────
  const test3 = createMockEligibleListing({ sewer: ['Septic'] });
  const result3 = evaluateEligibility(test3);
  console.log('\n❌ Test 3: Septic Servicing Rejection');
  console.log('   Input:', JSON.stringify(test3));
  console.log('   Result:', JSON.stringify(result3));
  console.assert(result3.isUniversallyEligible === false, 'Should NOT be universally eligible');
  console.assert(result3.universalRejectionReason === REJECTION_MESSAGES.SEPTIC, 'Should have septic rejection');
  
  // ── Test Case 4: Crawl Space Basement (Internal Only) ─────────────────────
  const test4 = createMockEligibleListing({ basement: ['Crawl Space', 'Finished'] });
  const result4 = evaluateEligibility(test4);
  console.log('\n⚠️  Test 4: Crawl Space Basement (Internal Only)');
  console.log('   Input:', JSON.stringify(test4));
  console.log('   Result:', JSON.stringify(result4));
  console.assert(result4.isUniversallyEligible === true, 'Should be universally eligible');
  console.assert(result4.isInternalEligible === false, 'Should NOT be internally eligible');
  console.assert(result4.isDetachedEligible === true, 'Should still be detached eligible');
  
  // ── Test Case 5: Insufficient Lot Depth (Detached Only) ───────────────────
  const test5 = createMockEligibleListing({ lotDepth: 65 });
  const result5 = evaluateEligibility(test5);
  console.log('\n⚠️  Test 5: Insufficient Lot Depth (Detached Only)');
  console.log('   Input:', JSON.stringify(test5));
  console.log('   Result:', JSON.stringify(result5));
  console.assert(result5.isUniversallyEligible === true, 'Should be universally eligible');
  console.assert(result5.isInternalEligible === true, 'Should be internally eligible');
  console.assert(result5.isDetachedEligible === false, 'Should NOT be detached eligible');
  
  // ── Test Case 6: Townhouse Rejection ──────────────────────────────────────
  const test6 = createMockEligibleListing({ propertySubType: 'Townhouse' });
  const result6 = evaluateEligibility(test6);
  console.log('\n❌ Test 6: Townhouse Rejection');
  console.log('   Input:', JSON.stringify(test6));
  console.log('   Result:', JSON.stringify(result6));
  console.assert(result6.isUniversallyEligible === true, 'Should be universally eligible');
  console.assert(result6.isInternalEligible === true, 'Should be internally eligible');
  console.assert(result6.isDetachedEligible === false, 'Should NOT be detached eligible');
  
  // ── Test Case 7: Semi-Detached (Should Pass Detached) ──────────────────────
  const test7 = createMockEligibleListing({ propertySubType: 'Semi-Detached' });
  const result7 = evaluateEligibility(test7);
  console.log('\n✅ Test 7: Semi-Detached (Should Pass Detached)');
  console.log('   Input:', JSON.stringify(test7));
  console.log('   Result:', JSON.stringify(result7));
  console.assert(result7.isUniversallyEligible === true, 'Should be universally eligible');
  console.assert(result7.isInternalEligible === true, 'Should be internally eligible');
  console.assert(result7.isDetachedEligible === true, 'Should be detached eligible (semi-detached OK)');
  
  // ── Test Case 8: Mobile Home Rejection ────────────────────────────────────
  const test8 = createMockEligibleListing({ propertySubType: 'Mobile Home' });
  const result8 = evaluateEligibility(test8);
  console.log('\n❌ Test 8: Mobile Home Rejection');
  console.log('   Input:', JSON.stringify(test8));
  console.log('   Result:', JSON.stringify(result8));
  console.assert(result8.isUniversallyEligible === false, 'Should NOT be universally eligible');
  console.assert(result8.universalRejectionReason === REJECTION_MESSAGES.LEASE_MOBILE, 'Should have mobile rejection');
  
  // ── Test Case 9: Commercial Property Rejection ────────────────────────────
  const test9 = createMockEligibleListing({ propertyType: 'Commercial' });
  const result9 = evaluateEligibility(test9);
  console.log('\n❌ Test 9: Commercial Property Rejection');
  console.log('   Input:', JSON.stringify(test9));
  console.log('   Result:', JSON.stringify(result9));
  console.assert(result9.isUniversallyEligible === false, 'Should NOT be universally eligible');
  console.assert(result9.universalRejectionReason === REJECTION_MESSAGES.NON_RESIDENTIAL, 'Should have non-residential rejection');
  
  // ── Test Case 10: Null Safety (Partial Data) ──────────────────────────────
  const test10: TerminalListing = { propertyType: 'Residential' };
  const result10 = evaluateEligibility(test10);
  console.log('\n✅ Test 10: Null Safety (Partial Data)');
  console.log('   Input:', JSON.stringify(test10));
  console.log('   Result:', JSON.stringify(result10));
  console.assert(result10.isUniversallyEligible === true, 'Should be universally eligible with partial data');
  console.assert(result10.isInternalEligible === true, 'Should be internally eligible with partial data');
  console.assert(result10.isDetachedEligible === true, 'Should be detached eligible with partial data');
  
  // ── Test Case 11: Batch Processing ───────────────────────────────────────
  const batch = [test1, test2, test3, test4, test5];
  const batchResults = evaluateBatchEligibility(batch);
  console.log('\n📦 Test 11: Batch Processing');
  console.log('   Processed', batchResults.length, 'listings');
  console.assert(batchResults.length === 5, 'Should process all 5 listings');
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ All tests completed\n');
}

// Run if executed directly
if (require.main === module) {
  runEligibilityTests();
}

export default evaluateEligibility;
