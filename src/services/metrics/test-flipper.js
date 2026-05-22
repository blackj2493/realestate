/**
 * Shadow MLS - Flipper Metrics Test Suite
 * 
 * Tests the ETL calculation services for the Flipper & Deal Hunter persona.
 * Run: node src/services/metrics/test-flipper.js
 */

const { AssignmentDetector, detectAssignmentSale, matchesAssignmentPattern } = require('./AssignmentDetector');
const { DistressAnalysisEngine, detectLegalDistress, scoreConditionFactors, evaluateScore } = require('./DistressAnalysisEngine');
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
    failed++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
  }
}

function assertGreaterThanOrEqual(actual, min, message = '') {
  if (actual < min) {
    throw new Error(`${message}\n  Expected: >= ${min}\n  Actual: ${actual}`);
  }
}

console.log('\n🧪 Shadow MLS - Flipper Metrics Test Suite\n');
console.log('='.repeat(60));

// ============================================================================
// AssignmentDetector Tests
// ============================================================================
console.log('\n📋 AssignmentDetector Tests\n');

test('matchesAssignmentPattern - matches assignment sale', () => {
  assertEqual(matchesAssignmentPattern('This is an assignment sale opportunity'), true);
});

test('matchesAssignmentPattern - matches assign. sale', () => {
  assertEqual(matchesAssignmentPattern('assign. sale - great deal'), true);
});

test('matchesAssignmentPattern - matches pre-construction assignment', () => {
  assertEqual(matchesAssignmentPattern('Pre-construction assignment available'), true);
});

test('matchesAssignmentPattern - no match on standard listing', () => {
  assertEqual(matchesAssignmentPattern('Beautiful family home in desirable neighborhood'), false);
});

test('matchesAssignmentPattern - handles null/undefined', () => {
  assertEqual(matchesAssignmentPattern(null), false);
  assertEqual(matchesAssignmentPattern(undefined), false);
});

test('detectAssignmentSale - detects assignment with zero tax', () => {
  const listing = {
    PublicRemarks: 'Assignment sale - original purchase price was $400,000',
    PublicRemarksExtras: '',
    Directions: '',
    TaxAnnualAmount: 0,
  };
  const result = detectAssignmentSale(listing);
  assertEqual(result.isAssignment, true);
  assertEqual(result.distressScore, 50);
  assertEqual(result.dealTypeFlag, 'ASSIGNMENT_SALE');
});

test('detectAssignmentSale - detects assignment with null tax', () => {
  const listing = {
    PublicRemarks: 'Exclusive assignment sale',
    TaxAnnualAmount: null,
  };
  const result = detectAssignmentSale(listing);
  assertEqual(result.isAssignment, true);
});

test('detectAssignmentSale - does not match standard listing', () => {
  const listing = {
    PublicRemarks: 'Stunning renovated home',
    TaxAnnualAmount: 5000,
  };
  const result = detectAssignmentSale(listing);
  assertEqual(result.isAssignment, false);
  assertEqual(result.distressScore, 0);
});

test('AssignmentDetector - main export', () => {
  const listing = { PublicRemarks: 'Assignment sale', TaxAnnualAmount: 0 };
  const result = AssignmentDetector(listing);
  assertEqual(result.isAssignment, true);
  assertEqual(result.source, 'AssignmentDetector');
});

// ============================================================================
// DistressAnalysisEngine Tests
// ============================================================================
console.log('\n📋 DistressAnalysisEngine Tests\n');

test('detectLegalDistress - matches power of sale', () => {
  assertEqual(detectLegalDistress('Power of sale - lender must sell'), true);
});

test('detectLegalDistress - matches court ordered', () => {
  assertEqual(detectLegalDistress('Court ordered sale'), true);
});

test('detectLegalDistress - matches estate sale', () => {
  assertEqual(detectLegalDistress('Estate sale - motivated seller'), true);
});

test('detectLegalDistress - no match on standard listing', () => {
  assertEqual(detectLegalDistress('Beautiful move-in ready home'), false);
});

test('scoreConditionFactors - matches condition patterns (+3)', () => {
  const listing = {
    PublicRemarks: 'Sold as-is where-is, no representations, buyer to verify',
    Directions: '',
    OccupantType: 'Tenanted',
    BasementType: 'Unfinished',
  };
  const score = scoreConditionFactors(listing, 90);
  assertGreaterThanOrEqual(score, 3);
});

test('scoreConditionFactors - vacant property (+1)', () => {
  const listing = {
    PublicRemarks: 'Great location',
    Directions: '',
    OccupantType: 'Vacant',
    BasementType: 'Finished',
  };
  const score = scoreConditionFactors(listing, 30);
  assertGreaterThanOrEqual(score, 1);
});

test('scoreConditionFactors - unfinished basement (+1)', () => {
  const listing = {
    PublicRemarks: 'Great location',
    Directions: '',
    OccupantType: 'Owner',
    BasementType: 'Unfinished',
  };
  const score = scoreConditionFactors(listing, 30);
  assertGreaterThanOrEqual(score, 1);
});

test('scoreConditionFactors - high DOM (+1 for >60, +2 for >120)', () => {
  const listing = {
    PublicRemarks: 'Great location',
    Directions: '',
    OccupantType: 'Owner',
    BasementType: 'Full',
  };
  const score60 = scoreConditionFactors(listing, 61);
  const score120 = scoreConditionFactors(listing, 121);
  assertGreaterThanOrEqual(score60, 1);
  assertGreaterThanOrEqual(score120, 3); // 1 for DOM>60 + 2 for DOM>120
});

test('evaluateScore - FIXER_UPPER (>= 4)', () => {
  const result = evaluateScore(4);
  assertEqual(result.distressScore, 75);
  assertEqual(result.dealTypeFlag, 'FIXER_UPPER');
});

test('evaluateScore - MOTIVATED_SELLER (=== 3)', () => {
  const result = evaluateScore(3);
  assertEqual(result.distressScore, 40);
  assertEqual(result.dealTypeFlag, 'MOTIVATED_SELLER');
});

test('evaluateScore - STANDARD (else)', () => {
  const result = evaluateScore(2);
  assertEqual(result.distressScore, 0);
  assertEqual(result.dealTypeFlag, 'STANDARD');
});

test('DistressAnalysisEngine - Tier 1 legal distress', () => {
  const listing = {
    PublicRemarks: 'Power of sale - lender must sell',
    Directions: '',
    OccupantType: 'Owner',
    BasementType: 'Full',
  };
  const result = DistressAnalysisEngine(listing);
  assertEqual(result.distressScore, 100);
  assertEqual(result.dealTypeFlag, 'LEGAL_DISTRESS');
  assertEqual(result.source, 'DistressAnalysisEngine.Tier1');
});

test('DistressAnalysisEngine - Tier 2 fixer upper', () => {
  const listing = {
    PublicRemarks: 'Sold as-is where-is, handyman special',
    Directions: '',
    OccupantType: 'Vacant',
    BasementType: 'Unfinished',
  };
  const result = DistressAnalysisEngine(listing, { trueDom: 130 });
  assertEqual(result.distressScore, 75);
  assertEqual(result.dealTypeFlag, 'FIXER_UPPER');
});

test('DistressAnalysisEngine - Tier 2 motivated seller', () => {
  // 3 points: condition (+3), NOT vacant, NOT unfinished, DOM <= 60
  const listing = {
    PublicRemarks: 'Needs TLC, bring your contractor',
    Directions: '',
    OccupantType: 'Owner',  // NOT vacant
    BasementType: 'Finished',  // NOT unfinished
  };
  const result = DistressAnalysisEngine(listing, { trueDom: 30 });  // DOM <= 60
  assertEqual(result.distressScore, 40);
  assertEqual(result.dealTypeFlag, 'MOTIVATED_SELLER');
});

// ============================================================================
// HoldingCostCalculator Tests
// ============================================================================
console.log('\n📋 HoldingCostCalculator Tests\n');

test('calculateHoldingComponents - freehold property', () => {
  const listing = {
    ListPrice: 500000,
    TaxAnnualAmount: 6000,
    AssociationFee: 0,
    PropertyType: 'Detached',
  };
  const components = calculateHoldingComponents(listing, 500000, 0.0799, false);
  
  assertGreaterThanOrEqual(components.interest, 2000);
  assertGreaterThanOrEqual(components.taxes, 400);
  assertEqual(components.vacancyInsurance, 250);
  assertEqual(components.utilities, 350);
  assertEqual(components.hoaFees, 0);
  assertGreaterThanOrEqual(components.maintenanceReserve, 150);
});

test('calculateHoldingComponents - condo property', () => {
  const listing = {
    ListPrice: 500000,
    TaxAnnualAmount: 3000,
    AssociationFee: 500,
    PropertyType: 'Condo Apartment',
  };
  const components = calculateHoldingComponents(listing, 500000, 0.0799, true);
  
  assertEqual(components.vacancyInsurance, 90); // condo rate
  assertEqual(components.utilities, 120); // condo rate
  assertEqual(components.hoaFees, 500);
});

test('HoldingCostCalculatorSync - basic calculation', () => {
  const listing = {
    ListPrice: 500000,
    TaxAnnualAmount: 6000,
    AssociationFee: 0,
    PropertyType: 'Detached',
  };
  const result = HoldingCostCalculatorSync(listing);
  
  assertGreaterThanOrEqual(result.maxHoldingCost, 3000); // should be reasonable
  assertEqual(result.isFallback, false);
});

test('HoldingCostCalculatorSync - handles missing tax', () => {
  const listing = {
    ListPrice: 500000,
    TaxAnnualAmount: null,
    AssociationFee: 0,
    PropertyType: 'Detached',
  };
  const result = HoldingCostCalculatorSync(listing);
  
  // Should use 1% estimate for taxes
  assertGreaterThanOrEqual(result.maxHoldingCost, 3000);
});

// ============================================================================
// PriceCompressionEngine Tests
// ============================================================================
console.log('\n📋 PriceCompressionEngine Tests\n');

test('generatePID - basic generation', () => {
  const listing = {
    StreetNumber: '123',
    StreetName: 'Main Street',
    City: 'Toronto',
  };
  const pid = generatePID(listing);
  assertEqual(pid, '123|main street|toronto');
});

test('generatePID - handles missing fields', () => {
  assertEqual(generatePID({ StreetNumber: '123' }), null);
  assertEqual(generatePID({ StreetName: 'Main' }), null);
  assertEqual(generatePID({ City: 'Toronto' }), null);
});

test('generatePID - case normalization', () => {
  const listing = {
    StreetNumber: '456',
    StreetName: 'OAK AVENUE',
    City: 'MISSISSAUGA',
  };
  const pid = generatePID(listing);
  assertEqual(pid, '456|oak avenue|mississauga');
});

test('calcPriceDropPct - normal drop', () => {
  const drop = calcPriceDropPct(500000, 400000);
  assertEqual(drop, 20.0);
});

test('calcPriceDropPct - no drop', () => {
  const drop = calcPriceDropPct(500000, 500000);
  assertEqual(drop, 0);
});

test('calcPriceDropPct - handles edge cases', () => {
  assertEqual(calcPriceDropPct(0, 100), 0);
  assertEqual(calcPriceDropPct(100, 0), 0);
  assertEqual(calcPriceDropPct(null, 100), 0);
});

test('calcPriceVelocity - normal velocity', () => {
  const velocity = calcPriceVelocity(500000, 450000);
  assertEqual(velocity, 10.0);
});

test('calcPriceVelocity - handles edge cases', () => {
  assertEqual(calcPriceVelocity(0, 100), 0);
  assertEqual(calcPriceVelocity(100, 0), 0);
});

test('PriceCompressionEngineSync - normal calculation', () => {
  const listing = { ListPrice: 400000 };
  const result = PriceCompressionEngineSync(listing, { historicalPrices: [450000, 500000] });
  
  assertEqual(result.peakPrice, 500000);
  assertEqual(result.truePriceDropPct, 20.0); // (500000-400000)/500000 * 100
  assertEqual(result.capitalDiscount, 100000);
});

test('PriceCompressionEngineSync - skips low price', () => {
  const listing = { ListPrice: 150000 };
  const result = PriceCompressionEngineSync(listing, { historicalPrices: [180000] });
  
  assertEqual(result.truePriceDropPct, 0);
  assertEqual(result.skippedLowPrice, true);
});

test('PriceCompressionEngineSync - handles empty history', () => {
  const listing = { ListPrice: 400000 };
  const result = PriceCompressionEngineSync(listing, { historicalPrices: [] });
  
  assertEqual(result.peakPrice, 400000);
  assertEqual(result.truePriceDropPct, 0);
  assertEqual(result.capitalDiscount, 0);
});

// ============================================================================
// ETLPipeline Tests
// ============================================================================
console.log('\n📋 ETLPipeline Tests\n');

test('mergeDistressResults - assignment takes precedence', () => {
  const assignment = { isAssignment: true, distressScore: 50, dealTypeFlag: 'ASSIGNMENT_SALE' };
  const distress = { distressScore: 40, dealTypeFlag: 'MOTIVATED_SELLER' };
  
  const result = mergeDistressResults(assignment, distress);
  
  assertEqual(result.distressScore, 50);
  assertEqual(result.dealTypeFlag, 'ASSIGNMENT_SALE');
  assertEqual(result.isAssignment, true);
});

test('mergeDistressResults - higher distress score wins', () => {
  const assignment = { isAssignment: true, distressScore: 50, dealTypeFlag: 'ASSIGNMENT_SALE' };
  const distress = { distressScore: 100, dealTypeFlag: 'LEGAL_DISTRESS' };
  
  const result = mergeDistressResults(assignment, distress);
  
  assertEqual(result.distressScore, 100);
  assertEqual(result.dealTypeFlag, 'LEGAL_DISTRESS');
  assertEqual(result.isAssignment, false);
});

test('mergeDistressResults - no assignment, use distress', () => {
  const assignment = { isAssignment: false, distressScore: 0, dealTypeFlag: 'STANDARD' };
  const distress = { distressScore: 75, dealTypeFlag: 'FIXER_UPPER' };
  
  const result = mergeDistressResults(assignment, distress);
  
  assertEqual(result.distressScore, 75);
  assertEqual(result.dealTypeFlag, 'FIXER_UPPER');
  assertEqual(result.isAssignment, false);
});

// ============================================================================
// Summary
// ============================================================================
console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.error('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
  process.exit(0);
}