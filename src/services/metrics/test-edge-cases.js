/**
 * Shadow MLS - ETL Edge Case Tests
 * 
 * Tests edge cases for the flipper ETL pipeline:
 * - ListPrice < 200k (GTA war zone)
 * - ListPrice < 400k Detached (subtype avg fallback)
 * - Empty/missing TaxAnnualAmount
 * - Empty price_history_cache
 * - Invalid NaN fallback logging
 * 
 * Run: node src/services/metrics/test-edge-cases.js
 */

const { AssignmentDetector, detectAssignmentSale } = require('./AssignmentDetector');
const { DistressAnalysisEngine } = require('./DistressAnalysisEngine');
const { HoldingCostCalculatorSync, calculateHoldingComponents, DEFAULT_INVESTOR_RATE } = require('./HoldingCostCalculator');
const { PriceCompressionEngineSync, generatePID, calcPriceDropPct, calcPriceVelocity } = require('./PriceCompressionEngine');
const { mergeDistressResults } = require('./ETLPipeline');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ❌ ${name}`);
    console.error(`     Error: ${error.message}`);
    if (error.stack) {
      console.error(`     Stack: ${error.stack.split('\n').slice(1, 3).join('\n')}`);
    }
    failed++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
  }
}

function assertGreaterThan(actual, min, message = '') {
  if (actual <= min) {
    throw new Error(`${message}\n  Expected: > ${min}\n  Actual: ${actual}`);
  }
}

function assertGreaterThanOrEqual(actual, min, message = '') {
  if (actual < min) {
    throw new Error(`${message}\n  Expected: >= ${min}\n  Actual: ${actual}`);
  }
}

console.log('\n🧪 Shadow MLS - ETL Edge Case Test Suite\n');
console.log('='.repeat(60));

// ============================================================================
// Edge Case 1: ListPrice < 200k (GTA war zone)
// ============================================================================
console.log('\n📋 Edge Case 1: ListPrice < 200k (GTA war zone)\n');

test('PriceCompressionEngine - skips < 200k listings', () => {
  const listing = { ListPrice: 150000 };
  const result = PriceCompressionEngineSync(listing, { historicalPrices: [180000, 200000] });
  
  assertEqual(result.truePriceDropPct, 0);
  assertEqual(result.skippedLowPrice, true);
});

test('PriceCompressionEngine - 200k boundary is included', () => {
  const listing = { ListPrice: 200000 };
  const result = PriceCompressionEngineSync(listing, { historicalPrices: [250000] });
  
  assertEqual(result.skippedLowPrice, undefined); // not skipped
  assertEqual(result.peakPrice, 250000);
});

test('PriceCompressionEngine - handles 199999 boundary', () => {
  const listing = { ListPrice: 199999 };
  const result = PriceCompressionEngineSync(listing, { historicalPrices: [220000] });
  
  assertEqual(result.truePriceDropPct, 0);
  assertEqual(result.skippedLowPrice, true);
});

// ============================================================================
// Edge Case 2: ListPrice < 400k Detached (subtype avg fallback)
// ============================================================================
console.log('\n📋 Edge Case 2: ListPrice < 400k Detached (subtype avg fallback)\n');

test('HoldingCostCalculator - Detached < 400k uses subtype avg logic', () => {
  const listing = {
    ListPrice: 350000,
    PropertySubType: 'Detached',
    TaxAnnualAmount: null,
    AssociationFee: 0,
    PropertyType: 'Detached',
  };
  const result = HoldingCostCalculatorSync(listing, { rate: 0.0799 });
  
  // With no tax and low price, should use fallback calculation
  // Monthly should be > 0
  assertGreaterThan(result.maxHoldingCost, 0);
});

test('HoldingCostCalculator - Semi-Detached < 400k uses avg logic', () => {
  const listing = {
    ListPrice: 380000,
    PropertySubType: 'Semi-Detached',
    TaxAnnualAmount: null,
    AssociationFee: 0,
    PropertyType: 'Semi-Detached',
  };
  const result = HoldingCostCalculatorSync(listing, { rate: 0.0799 });
  
  assertGreaterThan(result.maxHoldingCost, 0);
});

test('HoldingCostCalculator - Link < 400k uses avg logic', () => {
  const listing = {
    ListPrice: 390000,
    PropertySubType: 'Link',
    TaxAnnualAmount: null,
    AssociationFee: 0,
    PropertyType: 'Link',
  };
  const result = HoldingCostCalculatorSync(listing, { rate: 0.0799 });
  
  assertGreaterThan(result.maxHoldingCost, 0);
});

test('HoldingCostCalculator - Condo < 400k does NOT use avg fallback', () => {
  const listing = {
    ListPrice: 350000,
    PropertySubType: 'Condo Apartment',
    TaxAnnualAmount: 2500,
    AssociationFee: 400,
    PropertyType: 'Condo Apartment',
  };
  const result = HoldingCostCalculatorSync(listing, { rate: 0.0799 });
  
  // Condo is not in cheap types list, should still calculate normally
  assertGreaterThan(result.maxHoldingCost, 0);
});

// ============================================================================
// Edge Case 3: Empty/missing TaxAnnualAmount
// ============================================================================
console.log('\n📋 Edge Case 3: Empty/missing TaxAnnualAmount\n');

test('AssignmentDetector - null TaxAnnualAmount still flags assignment', () => {
  const listing = {
    PublicRemarks: 'Assignment sale opportunity',
    TaxAnnualAmount: null,
  };
  const result = detectAssignmentSale(listing);
  assertEqual(result.isAssignment, true);
  assertEqual(result.distressScore, 50);
});

test('AssignmentDetector - undefined TaxAnnualAmount still flags assignment', () => {
  const listing = {
    PublicRemarks: 'Assignment sale - original purchase price was $400k',
    TaxAnnualAmount: undefined,
  };
  const result = detectAssignmentSale(listing);
  assertEqual(result.isAssignment, true);
});

test('AssignmentDetector - 0 TaxAnnualAmount still flags assignment', () => {
  const listing = {
    PublicRemarks: 'Pre-construction assignment',
    TaxAnnualAmount: 0,
  };
  const result = detectAssignmentSale(listing);
  assertEqual(result.isAssignment, true);
});

test('HoldingCostCalculator - null tax uses 1% estimate', () => {
  const listing = {
    ListPrice: 500000,
    TaxAnnualAmount: null,
    AssociationFee: 0,
    PropertyType: 'Detached',
  };
  const result = HoldingCostCalculatorSync(listing, { rate: 0.0799 });
  
  // Should use 1% estimate for taxes
  // 1% of 500k = 5000/year = 417/month
  const taxComponent = result.components?.taxes || 0;
  assertGreaterThanOrEqual(taxComponent, 400);
});

test('HoldingCostCalculator - undefined tax uses 1% estimate', () => {
  const listing = {
    ListPrice: 600000,
    TaxAnnualAmount: undefined,
    AssociationFee: 0,
    PropertyType: 'Detached',
  };
  const result = HoldingCostCalculatorSync(listing, { rate: 0.0799 });
  
  const taxComponent = result.components?.taxes || 0;
  assertGreaterThanOrEqual(taxComponent, 450); // 1% of 600k = 6000/yr = 500/mo
});

// ============================================================================
// Edge Case 4: Empty price_history_cache
// ============================================================================
console.log('\n📋 Edge Case 4: Empty price_history_cache\n');

test('PriceCompressionEngine - empty history returns current as peak', () => {
  const listing = { ListPrice: 450000 };
  const result = PriceCompressionEngineSync(listing, { historicalPrices: [] });
  
  assertEqual(result.peakPrice, 450000);
  assertEqual(result.truePriceDropPct, 0);
  assertEqual(result.capitalDiscount, 0);
});

test('PriceCompressionEngine - undefined history returns current as peak', () => {
  const listing = { ListPrice: 425000 };
  const result = PriceCompressionEngineSync(listing, { historicalPrices: undefined });
  
  assertEqual(result.peakPrice, 425000);
  assertEqual(result.truePriceDropPct, 0);
});

test('PriceCompressionEngine - single price in history works', () => {
  const listing = { ListPrice: 380000 };
  const result = PriceCompressionEngineSync(listing, { historicalPrices: [420000] });
  
  assertEqual(result.peakPrice, 420000);
  assertGreaterThan(result.truePriceDropPct, 0);
});

// ============================================================================
// Edge Case 5: Invalid NaN fallback logging
// ============================================================================
console.log('\n📋 Edge Case 5: Invalid NaN fallback logging\n');

test('HoldingCostCalculator - 0 list price returns non-zero (fixed costs only)', () => {
  const listing = {
    ListPrice: 0,
    TaxAnnualAmount: null,
    AssociationFee: 0,
    PropertyType: 'Detached',
  };
  const result = HoldingCostCalculatorSync(listing, { rate: 0.0799 });
  
  // With 0 list price, only fixed costs apply (insurance + utilities + maintenance)
  // isFallback would be false because calculation is valid, just small
  // Result should be > 0 due to fixed costs
  assertGreaterThan(result.maxHoldingCost, 0);
});

test('HoldingCostCalculator - negative price uses absolute value', () => {
  const listing = {
    ListPrice: -1000,
    TaxAnnualAmount: 5000,
    AssociationFee: 0,
    PropertyType: 'Detached',
  };
  const result = HoldingCostCalculatorSync(listing, { rate: 0.0799 });
  
  // Should still calculate (uses absolute value or handles gracefully)
  assertGreaterThan(result.maxHoldingCost, 0);
});

test('calcPriceDropPct - NaN handling returns 0', () => {
  const drop = calcPriceDropPct(NaN, 100);
  assertEqual(drop, 0);
});

test('calcPriceDropPct - Infinity handling returns 0', () => {
  const drop = calcPriceDropPct(Infinity, 100);
  assertEqual(drop, 0);
  const drop2 = calcPriceDropPct(100, Infinity);
  assertEqual(drop2, 0);
});

test('calcPriceVelocity - NaN handling returns 0', () => {
  const velocity = calcPriceVelocity(NaN, 100);
  assertEqual(velocity, 0);
});

test('calcPriceVelocity - Infinity handling returns 0', () => {
  const velocity = calcPriceVelocity(Infinity, 100);
  assertEqual(velocity, 0);
});

// ============================================================================
// Edge Case 6: PID generation edge cases
// ============================================================================
console.log('\n📋 Edge Case 6: PID generation edge cases\n');

test('generatePID - missing street number returns null', () => {
  const listing = { StreetName: 'Main St', City: 'Toronto' };
  assertEqual(generatePID(listing), null);
});

test('generatePID - missing street name returns null', () => {
  const listing = { StreetNumber: '123', City: 'Toronto' };
  assertEqual(generatePID(listing), null);
});

test('generatePID - missing city returns null', () => {
  const listing = { StreetNumber: '123', StreetName: 'Main St' };
  assertEqual(generatePID(listing), null);
});

test('generatePID - whitespace normalization', () => {
  const listing = { StreetNumber: '  45  ', StreetName: '  OAK   Avenue  ', City: '  TORONTO  ' };
  const pid = generatePID(listing);
  assertEqual(pid, '45|oak avenue|toronto');
});

// ============================================================================
// Edge Case 7: Assignment with non-zero tax (lower confidence)
// ============================================================================
console.log('\n📋 Edge Case 7: Assignment with non-zero tax (lower confidence)\n');

test('AssignmentDetector - assignment with tax has lower score', () => {
  const listing = {
    PublicRemarks: 'Assignment sale available',
    TaxAnnualAmount: 5000, // non-zero
  };
  const result = detectAssignmentSale(listing);
  
  // Should still detect but with lower confidence
  assertEqual(result.isAssignment, true);
  assertEqual(result.distressScore, 40); // 50 - 10
});

// ============================================================================
// Edge Case 8: Distress scoring edge cases
// ============================================================================
console.log('\n📋 Edge Case 8: Distress scoring edge cases\n');

test('DistressAnalysisEngine - handles null PublicRemarks', () => {
  const listing = {
    PublicRemarks: null,
    Directions: '',
    OccupantType: 'Owner',
    BasementType: 'Finished',
  };
  const result = DistressAnalysisEngine(listing, { trueDom: 30 });
  assertEqual(result.dealTypeFlag, 'STANDARD');
  assertEqual(result.distressScore, 0);
});

test('DistressAnalysisEngine - handles null Directions', () => {
  const listing = {
    PublicRemarks: 'Great location home',
    Directions: null,
    OccupantType: 'Owner',
    BasementType: 'Finished',
  };
  const result = DistressAnalysisEngine(listing, { trueDom: 30 });
  assertEqual(result.dealTypeFlag, 'STANDARD');
});

test('DistressAnalysisEngine - handles undefined trueDom with no distress signals', () => {
  const listing = {
    PublicRemarks: 'Beautiful family home in great area',
    Directions: '',
    OccupantType: 'Owner',
    BasementType: 'Finished',
  };
  const result = DistressAnalysisEngine(listing, {});
  // No condition patterns, no vacant, no unfinished basement, DOM=0 → score=0
  assertEqual(result.distressScore, 0);
  assertEqual(result.dealTypeFlag, 'STANDARD');
});

// ============================================================================
// Edge Case 9: Merge distress results edge cases
// ============================================================================
console.log('\n📋 Edge Case 9: Merge distress results edge cases\n');

test('mergeDistressResults - both false uses distress', () => {
  const assignment = { isAssignment: false, distressScore: 0, dealTypeFlag: 'STANDARD' };
  const distress = { distressScore: 75, dealTypeFlag: 'FIXER_UPPER' };
  const result = mergeDistressResults(assignment, distress);
  assertEqual(result.distressScore, 75);
  assertEqual(result.dealTypeFlag, 'FIXER_UPPER');
});

test('mergeDistressResults - assignment false with legal distress', () => {
  const assignment = { isAssignment: false, distressScore: 0, dealTypeFlag: 'STANDARD' };
  const distress = { distressScore: 100, dealTypeFlag: 'LEGAL_DISTRESS' };
  const result = mergeDistressResults(assignment, distress);
  assertEqual(result.distressScore, 100);
  assertEqual(result.dealTypeFlag, 'LEGAL_DISTRESS');
  assertEqual(result.isAssignment, false);
});

test('mergeDistressResults - both true assignment wins higher score', () => {
  const assignment = { isAssignment: true, distressScore: 50, dealTypeFlag: 'ASSIGNMENT_SALE' };
  const distress = { distressScore: 100, dealTypeFlag: 'LEGAL_DISTRESS' };
  const result = mergeDistressResults(assignment, distress);
  // Legal distress is higher, so it wins
  assertEqual(result.distressScore, 100);
  assertEqual(result.dealTypeFlag, 'LEGAL_DISTRESS');
});

// ============================================================================
// Summary
// ============================================================================
console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.error('❌ Some edge case tests failed!');
  process.exit(1);
} else {
  console.log('✅ All ETL Edge Case tests passed!');
  process.exit(0);
}