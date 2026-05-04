/**
 * Shadow MLS - Distress Engine for ADU/Suite Potential Scoring (Phase 2)
 * 
 * Analyzes raw real estate payloads to calculate probabilistic distress across three vectors:
 * - Financial Distress (Legal/Motivated Seller)
 * - Physical Distress (The Gut-Job / Heavy Value-Add)
 * - Temporal Distress (Stale Inventory)
 * 
 * This module executes heavy text analysis (regex) and heuristic logic to identify
 * motivated sellers and distressed properties that are candidates for value-add plays.
 * 
 * Output is flat booleans, integers, and string arrays ready to be indexed by Typesense
 * for sub-50ms filtering in the investor terminal.
 */

// ============================================================================
// Input Types
// ============================================================================

/**
 * Raw listing payload from the ProptX/VOW API.
 * Only fields needed for distress analysis are typed here.
 */
export interface DistressInput {
  /** Property type classification */
  PropertyType?: string | null;
  
  /** Property sub-type classification */
  PropertySubType?: string | null;
  
  /** Public listing remarks (rich text description) */
  PublicRemarks?: string | null;
  
  /** Agent-only remarks for clients */
  RemarksForClients?: string | null;
  
  /** Media/images array */
  media?: Array<{ MediaURL?: string | null; MediaStatus?: string | null }> | null;
  images?: Array<{ MediaURL?: string | null; MediaStatus?: string | null }> | null;
  
  /** Days on market (if available) */
  DaysOnMarket?: number | null;
  
  /** Listing entry timestamp */
  OriginalEntryTimestamp?: string | null;
  
  /** Allow any additional fields */
  [key: string]: unknown;
}

// ============================================================================
// Output Types
// ============================================================================

/**
 * Distress metrics output for Typesense indexing.
 * All fields are primitives for fast filtering.
 */
export interface DistressMetrics {
  /** Overall distress score (0-100) */
  distress_score: number;
  
  /** Array of distress vector tags */
  distress_vectors: string[];
  
  /** Financial/legal distress indicator */
  is_financial_distress: boolean;
  
  /** Physical/gut-job distress indicator */
  is_physical_distress: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * High-confidence financial distress keywords with associated scores.
 * These indicate legal/motivated seller situations.
 */
const FINANCIAL_HIGH_CONFIDENCE: Array<{ pattern: RegExp; tag: string; score: number }> = [
  { pattern: /power\s*[-]?\s*of\s*[-]?\s*sale/gi, tag: 'Power of Sale', score: 80 },
  { pattern: /foreclosure/gi, tag: 'Foreclosure', score: 80 },
  { pattern: /bank\s*[-]?\s*owned/gi, tag: 'Bank Owned', score: 80 },
  { pattern: /schedule\s*[bBcC]/g, tag: 'Schedule B/C', score: 80 },
  { pattern: /probate/gi, tag: 'Probate', score: 80 },
  { pattern: /estate\s*[-]?\s*sale/gi, tag: 'Estate Sale', score: 80 },
];

/**
 * Medium-confidence financial distress keywords.
 * These indicate motivated sellers but not necessarily distressed sales.
 */
const FINANCIAL_MEDIUM_CONFIDENCE: Array<{ pattern: RegExp; tag: string; score: number }> = [
  { pattern: /motivated\s*seller/gi, tag: 'Motivated Seller', score: 30 },
  { pattern: /bring\s*all\s*offers?/gi, tag: 'All Offers', score: 30 },
  { pattern: /must\s*sell/gi, tag: 'Must Sell', score: 30 },
  { pattern: /relocat(e|ing|ion)/gi, tag: 'Relocating', score: 30 },
  { pattern: /priced\s*to\s*sell/gi, tag: 'Priced to Sell', score: 30 },
  { pattern: /\btsf\b/gi, tag: 'TSF', score: 30 }, // "Terms considered"
  { pattern: /vacant\s*[-]?\s*property/gi, tag: 'Vacant Property', score: 25 },
];

/**
 * "As-Is" clause variations indicating seller motivation.
 */
const AS_IS_CLAUSE: Array<{ pattern: RegExp; tag: string; score: number }> = [
  { pattern: /as\s*[-]?\s*is/gi, tag: 'As-Is', score: 40 },
  { pattern: /as\s*[-]?\s*is\s*where\s*is/gi, tag: 'As-Is Where-Is', score: 40 },
  { pattern: /no\s*warrant(y|ies)/gi, tag: 'No Warranties', score: 40 },
  { pattern: /sold\s*[-]?\s*as\s*[-]?\s*is/gi, tag: 'Sold As-Is', score: 40 },
];

/**
 * Physical distress keywords indicating gut-job or heavy value-add potential.
 */
const PHYSICAL_DISTRESS: Array<{ pattern: RegExp; tag: string; score: number }> = [
  { pattern: /\btlc\b/gi, tag: 'Heavy Value-Add', score: 50 },
  { pattern: /handyman\s*special/gi, tag: 'Heavy Value-Add', score: 50 },
  { pattern: /contractor[\s-]*special/gi, tag: 'Heavy Value-Add', score: 50 },
  { pattern: /builder[\s-]*special/gi, tag: 'Heavy Value-Add', score: 50 },
  { pattern: /fixer[\s-]*upper/gi, tag: 'Heavy Value-Add', score: 50 },
  { pattern: /needs\s*work/gi, tag: 'Heavy Value-Add', score: 50 },
  { pattern: /renovator[\s'-]*(?:special|dream)/gi, tag: 'Heavy Value-Add', score: 50 },
  { pattern: /blank\s*canvas/gi, tag: 'Heavy Value-Add', score: 50 },
  { pattern: /value\s*in\s*(the\s*)?land/gi, tag: 'Heavy Value-Add', score: 50 },
  { pattern: /build\s*(your\s*)?dream\s*(home|house)?/gi, tag: 'Heavy Value-Add', score: 50 },
  { pattern: /demolition\s*(required)?/gi, tag: 'Heavy Value-Add', score: 55 },
  { pattern: /teardown/gi, tag: 'Heavy Value-Add', score: 55 },
  { pattern: /major\s*repairs?/gi, tag: 'Heavy Value-Add', score: 50 },
  { pattern: /structural\s*issues?/gi, tag: 'Heavy Value-Add', score: 50 },
  { pattern: /investor[\s'-]*(special|opportunity|paradise)/gi, tag: 'Heavy Value-Add', score: 45 },
];

/**
 * Maximum distress score cap.
 */
const MAX_DISTRESS_SCORE = 100;

/**
 * Photo heuristic threshold - fewer images suggests distressed or vacant property.
 */
const PHOTO_HEURISTIC_THRESHOLD = 5;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely extracts text from a field, returning empty string for null/undefined.
 */
function extractText(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

/**
 * Combines all remark fields into a single searchable text.
 */
function extractRemarks(input: DistressInput): string {
  const publicRemarks = extractText(input.PublicRemarks);
  const agentRemarks = extractText(input.RemarksForClients);
  return `${publicRemarks} ${agentRemarks}`;
}

/**
 * Counts active media/images (excluding deleted).
 */
function countActiveMedia(input: DistressInput): number {
  let count = 0;
  
  // Process media array
  if (Array.isArray(input.media)) {
    for (const item of input.media) {
      if (item?.MediaURL && item.MediaStatus !== 'Deleted') {
        count++;
      }
    }
  }
  
  // Process images array
  if (Array.isArray(input.images)) {
    for (const item of input.images) {
      if (item?.MediaURL && item.MediaStatus !== 'Deleted') {
        count++;
      }
    }
  }
  
  return count;
}

/**
 * Checks if property type indicates residential (not vacant land).
 */
function isResidentialProperty(input: DistressInput): boolean {
  const propType = extractText(input.PropertyType).toLowerCase();
  if (!propType) return false;
  
  // Exclude non-residential types
  const excluded = ['vacant', 'commercial', 'industrial', 'agricultural', 'parking', 'locker'];
  for (const type of excluded) {
    if (propType.includes(type)) return false;
  }
  
  return propType.includes('residential') || 
         propType.includes('condo') || 
         propType.includes('freehold');
}

/**
 * Checks if property subtype is vacant land.
 */
function isVacantLandSubtype(input: DistressInput): boolean {
  const subType = extractText(input.PropertySubType).toLowerCase();
  if (!subType) return false;
  
  return subType.includes('vacant') || 
         subType.includes('land') || 
         subType.includes('parking');
}

/**
 * Scores a text against a list of patterns with scoring rules.
 * Returns { score, matchedTags }
 */
function scorePatterns(
  text: string,
  patterns: Array<{ pattern: RegExp; tag: string; score: number }>
): { score: number; matchedTags: string[] } {
  let score = 0;
  const matchedTags: string[] = [];
  const usedPatterns = new Set<string>();
  
  for (const { pattern, tag, score: patternScore } of patterns) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    
    if (pattern.test(text)) {
      // Avoid duplicate tags from similar patterns
      if (!usedPatterns.has(tag)) {
        usedPatterns.add(tag);
        matchedTags.push(tag);
        score += patternScore;
      }
    }
  }
  
  return { score, matchedTags };
}

// ============================================================================
// Main Distress Calculation
// ============================================================================

/**
 * Calculates distress metrics for a raw listing payload.
 * 
 * @param input - Raw listing payload from ProptX/VOW API
 * @returns DistressMetrics object ready for Typesense indexing
 * 
 * @example
 * ```typescript
 * const rawPayload = await fetchListing();
 * const metrics = calculateDistress(rawPayload);
 * // metrics.distress_score = 95
 * // metrics.distress_vectors = ['Power of Sale', 'As-Is', 'Heavy Value-Add']
 * // metrics.is_financial_distress = true
 * // metrics.is_physical_distress = true
 * ```
 */
export function calculateDistress(input: DistressInput): DistressMetrics {
  // Initialize accumulators
  let totalScore = 0;
  const distressVectors: string[] = [];
  let isFinancialDistress = false;
  let isPhysicalDistress = false;
  
  // ── Extract Text for Analysis ───────────────────────────────────────────
  const remarks = extractRemarks(input);
  
  // ── Vector 1: Financial Distress Analysis ─────────────────────────────────
  // High-confidence patterns (legal/motivated situations)
  const financialHigh = scorePatterns(remarks, FINANCIAL_HIGH_CONFIDENCE);
  if (financialHigh.score > 0) {
    totalScore += financialHigh.score;
    distressVectors.push(...financialHigh.matchedTags);
    isFinancialDistress = true;
  }
  
  // Medium-confidence patterns (motivated seller indicators)
  const financialMedium = scorePatterns(remarks, FINANCIAL_MEDIUM_CONFIDENCE);
  if (financialMedium.score > 0) {
    totalScore += financialMedium.score;
    distressVectors.push(...financialMedium.matchedTags);
  }
  
  // As-Is clause variations
  const asIsPatterns = scorePatterns(remarks, AS_IS_CLAUSE);
  if (asIsPatterns.score > 0) {
    totalScore += asIsPatterns.score;
    distressVectors.push(...asIsPatterns.matchedTags);
  }
  
  // ── Vector 2: Physical Distress Analysis ─────────────────────────────────
  // Physical distress keywords (gut-job indicators)
  const physicalPatterns = scorePatterns(remarks, PHYSICAL_DISTRESS);
  if (physicalPatterns.score > 0) {
    totalScore += physicalPatterns.score;
    distressVectors.push(...physicalPatterns.matchedTags);
    isPhysicalDistress = true;
  }
  
  // ── Photo Heuristic: Low Image Count ─────────────────────────────────────
  // If residential property has very few images, likely a distressed or vacant listing
  const activeMediaCount = countActiveMedia(input);
  const isResidential = isResidentialProperty(input);
  const isVacantLand = isVacantLandSubtype(input);
  
  if (isResidential && activeMediaCount < PHOTO_HEURISTIC_THRESHOLD && !isVacantLand) {
    // Sparse photography often indicates: vacant, distressed, or seller doesn't care
    // This is a strong signal when combined with other distress indicators
    if (activeMediaCount <= 2) {
      totalScore += 60;
      if (!isPhysicalDistress) {
        distressVectors.push('Heavy Value-Add');
        isPhysicalDistress = true;
      } else {
        distressVectors.push('Sparse Photography');
      }
    } else if (activeMediaCount < PHOTO_HEURISTIC_THRESHOLD) {
      totalScore += 30;
      distressVectors.push('Limited Photography');
    }
  }
  
  // ── Vector 3: Temporal Distress (Stale Inventory) ───────────────────────────
  // Properties on market for extended periods may indicate seller motivation
  const daysOnMarket = input.DaysOnMarket;
  
  if (daysOnMarket !== null && daysOnMarket !== undefined) {
    if (daysOnMarket > 90) {
      totalScore += 40;
      distressVectors.push('Stale');
    } else if (daysOnMarket > 60) {
      totalScore += 25;
      distressVectors.push('Slow-Moving');
    } else if (daysOnMarket > 30) {
      totalScore += 10;
    }
  }
  
  // ── Calculate Original Entry Timestamp Staleness ──────────────────────────
  // Fallback if DaysOnMarket not available
  if (daysOnMarket === null || daysOnMarket === undefined) {
    const entryTimestamp = input.OriginalEntryTimestamp;
    if (typeof entryTimestamp === 'string' && entryTimestamp) {
      try {
        const entryDate = new Date(entryTimestamp);
        if (!isNaN(entryDate.getTime())) {
          const daysSinceEntry = Math.floor(
            (Date.now() - entryDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          
          if (daysSinceEntry > 90) {
            totalScore += 40;
            distressVectors.push('Stale');
          } else if (daysSinceEntry > 60) {
            totalScore += 25;
            distressVectors.push('Slow-Moving');
          }
        }
      } catch {
        // Invalid timestamp, ignore
      }
    }
  }
  
  // ── Score Normalization ───────────────────────────────────────────────────
  // Cap at maximum score
  const finalScore = Math.min(totalScore, MAX_DISTRESS_SCORE);
  
  // ── Deduplicate Distress Vectors ──────────────────────────────────────────
  const uniqueVectors = [...new Set(distressVectors)];
  
  return {
    distress_score: finalScore,
    distress_vectors: uniqueVectors,
    is_financial_distress: isFinancialDistress,
    is_physical_distress: isPhysicalDistress,
  };
}

/**
 * Calculates distress for a batch of listings.
 * 
 * @param listings - Array of raw listing payloads
 * @returns Array of DistressMetrics (same order as input)
 */
export function calculateBatchDistress(listings: DistressInput[]): DistressMetrics[] {
  if (!Array.isArray(listings)) {
    console.warn('calculateBatchDistress: Expected array, received non-array input');
    return [];
  }
  
  return listings.map(listing => calculateDistress(listing));
}

// ============================================================================
// Test & Dev Helpers
// ============================================================================

/**
 * Creates a mock distressed listing for testing.
 */
export function createMockDistressedListing(
  overrides: Partial<DistressInput> = {}
): DistressInput {
  return {
    PropertyType: 'Residential',
    PropertySubType: 'Detached',
    PublicRemarks: 'Power of Sale opportunity. Motivated seller. Home needs TLC and is being sold as-is where is. Great opportunity for the handy buyer.',
    RemarksForClients: 'Bank owned property. Must sell. Bring all offers.',
    media: [
      { MediaURL: 'https://example.com/photo1.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo2.jpg', MediaStatus: 'Active' },
    ],
    DaysOnMarket: 120,
    ...overrides,
  };
}

/**
 * Creates a pristine (non-distressed) listing for testing.
 */
export function createMockPristineListing(
  overrides: Partial<DistressInput> = {}
): DistressInput {
  return {
    PropertyType: 'Residential',
    PropertySubType: 'Detached',
    PublicRemarks: 'Beautiful family home with updated kitchen, hardwood floors throughout, and a finished basement. Walking distance to top-rated schools. Move-in ready!',
    RemarksForClients: 'Hot property - multiple offers expected.',
    media: [
      { MediaURL: 'https://example.com/photo1.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo2.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo3.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo4.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo5.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo6.jpg', MediaStatus: 'Active' },
    ],
    DaysOnMarket: 5,
    ...overrides,
  };
}

/**
 * Runs comprehensive test cases for distress calculation.
 */
export function runDistressTests(): void {
  console.log('\n🧪 Shadow MLS Distress Engine Tests');
  console.log('='.repeat(60));
  
  // ── Test Case 1: High Distress (Power of Sale + TLC + Low Images) ──────────
  const test1 = createMockDistressedListing();
  const result1 = calculateDistress(test1);
  console.log('\n🔥 Test 1: High Distress (Power of Sale + TLC + Low Images)');
  console.log('   Input:', JSON.stringify(test1, null, 2));
  console.log('   Result:', JSON.stringify(result1));
  console.assert(result1.distress_score >= 80, 'Should have high distress score');
  console.assert(result1.is_financial_distress === true, 'Should flag financial distress');
  console.assert(result1.distress_vectors.includes('Power of Sale'), 'Should have Power of Sale tag');
  
  // ── Test Case 2: Pristine Listing ─────────────────────────────────────────
  const test2 = createMockPristineListing();
  const result2 = calculateDistress(test2);
  console.log('\n✨ Test 2: Pristine Listing');
  console.log('   Input:', JSON.stringify(test2, null, 2));
  console.log('   Result:', JSON.stringify(result2));
  console.assert(result2.distress_score < 20, 'Should have low distress score');
  console.assert(result2.is_financial_distress === false, 'Should NOT flag financial distress');
  console.assert(result2.is_physical_distress === false, 'Should NOT flag physical distress');
  
  // ── Test Case 3: As-Is Clause Only ───────────────────────────────────────
  const test3: DistressInput = {
    PropertyType: 'Residential',
    PublicRemarks: 'Sold as-is where is. No warranties provided by seller.',
  };
  const result3 = calculateDistress(test3);
  console.log('\n⚠️  Test 3: As-Is Clause Only');
  console.log('   Input:', JSON.stringify(test3));
  console.log('   Result:', JSON.stringify(result3));
  console.assert(result3.distress_score >= 40, 'Should have moderate distress score');
  console.assert(result3.distress_vectors.some(v => v.includes('As-Is')), 'Should have As-Is tag');
  
  // ── Test Case 4: Null Remarks Handling ──────────────────────────────────
  // Note: Photo heuristic still fires for 0 images (correct behavior)
  const test4: DistressInput = {
    PropertyType: 'Residential',
    PublicRemarks: null,
    RemarksForClients: undefined,
    media: undefined,
    images: undefined,
  };
  const result4 = calculateDistress(test4);
  console.log('\n✅ Test 4: Null Remarks Handling');
  console.log('   Input:', JSON.stringify(test4));
  console.log('   Result:', JSON.stringify(result4));
  console.assert(result4.distress_score === 0, 'Should have zero distress with null remarks and no media');
  console.assert(result4.distress_vectors.length === 0, 'Should have no distress vectors');
  
  // ── Test Case 5: Photo Heuristic (Very Low Images) ────────────────────────
  const test5: DistressInput = {
    PropertyType: 'Residential',
    PropertySubType: 'Detached',
    PublicRemarks: 'Charming starter home in quiet neighborhood.',
    media: [
      { MediaURL: 'https://example.com/photo1.jpg', MediaStatus: 'Active' },
    ],
  };
  const result5 = calculateDistress(test5);
  console.log('\n📷 Test 5: Photo Heuristic (Very Low Images)');
  console.log('   Input:', JSON.stringify(test5));
  console.log('   Result:', JSON.stringify(result5));
  console.assert(result5.distress_score >= 60, 'Should add photo heuristic score');
  console.assert(result5.is_physical_distress === true, 'Should flag physical distress');
  
  // ── Test Case 6: Vacant Land Bypasses Photo Heuristic ────────────────────
  const test6: DistressInput = {
    PropertyType: 'Vacant Land',
    PropertySubType: 'Vacant Land',
    PublicRemarks: 'Empty lot ready for development.',
    media: [
      { MediaURL: 'https://example.com/photo1.jpg', MediaStatus: 'Active' },
    ],
  };
  const result6 = calculateDistress(test6);
  console.log('\n🏕️  Test 6: Vacant Land Bypasses Photo Heuristic');
  console.log('   Input:', JSON.stringify(test6));
  console.log('   Result:', JSON.stringify(result6));
  console.assert(result6.is_physical_distress === false, 'Should NOT flag physical distress for vacant land');
  
  // ── Test Case 7: Stale Listing (High Days on Market) ─────────────────────
  const test7: DistressInput = {
    PropertyType: 'Residential',
    PublicRemarks: 'Lovely home with great potential.',
    DaysOnMarket: 150,
  };
  const result7 = calculateDistress(test7);
  console.log('\n⏰ Test 7: Stale Listing (High Days on Market)');
  console.log('   Input:', JSON.stringify(test7));
  console.log('   Result:', JSON.stringify(result7));
  console.assert(result7.distress_vectors.includes('Stale'), 'Should have Stale tag');
  
  // ── Test Case 8: Foreclosure + As-Is Combo ────────────────────────────────
  const test8: DistressInput = {
    PropertyType: 'Residential',
    PublicRemarks: 'Foreclosure! Bank owned property sold as-is. No warranties expressed or implied. Motivated seller - bring all offers.',
  };
  const result8 = calculateDistress(test8);
  console.log('\n🏦 Test 8: Foreclosure + As-Is Combo');
  console.log('   Input:', JSON.stringify(test8));
  console.log('   Result:', JSON.stringify(result8));
  console.assert(result8.is_financial_distress === true, 'Should flag financial distress');
  console.assert(result8.distress_score >= 80, 'Should have very high score');
  
  // ── Test Case 9: Score Capping ─────────────────────────────────────────────
  const test9: DistressInput = {
    PropertyType: 'Residential',
    PublicRemarks: 'Foreclosure! Power of sale. Probate estate sale. Bank owned. Schedule B. Schedule C. As-is where is. No warranties. TLC. Handyman special. Contractor dream. Fixer upper. Must sell. Motivated seller. Relocating. Priced to sell.',
    DaysOnMarket: 200,
    media: [],
  };
  const result9 = calculateDistress(test9);
  console.log('\n🎯 Test 9: Score Capping');
  console.log('   Input:', JSON.stringify(test9));
  console.log('   Result:', JSON.stringify(result9));
  console.assert(result9.distress_score <= MAX_DISTRESS_SCORE, 'Score should be capped at 100');
  
  // ── Test Case 10: Batch Processing ────────────────────────────────────────
  const batch = [test1, test2, test3, test4, test5];
  const batchResults = calculateBatchDistress(batch);
  console.log('\n📦 Test 10: Batch Processing');
  console.log('   Processed', batchResults.length, 'listings');
  console.assert(batchResults.length === 5, 'Should process all 5 listings');
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ All distress tests completed\n');
}

// Run if executed directly
if (require.main === module) {
  runDistressTests();
}

export default calculateDistress;
