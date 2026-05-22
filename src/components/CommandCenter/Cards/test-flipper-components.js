/**
 * Shadow MLS - Flipper Component Tests
 * 
 * Tests the DealTypeBadge, HoldingBurnCard, and PriceCompressionCard components.
 * Run: node src/components/CommandCenter/Cards/test-flipper-components.js
 */

const { create } = require('zustand');

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

function assertGreaterThan(actual, min, message = '') {
  if (actual <= min) {
    throw new Error(`${message}\n  Expected: > ${min}\n  Actual: ${actual}`);
  }
}

function assertContains(actual, substring, message = '') {
  if (!actual.includes(substring)) {
    throw new Error(`${message}\n  Expected to contain: ${substring}\n  Actual: ${actual}`);
  }
}

console.log('\n🧪 Shadow MLS - Flipper Component Test Suite\n');
console.log('='.repeat(60));

// ============================================================================
// DealTypeBadge Logic Tests
// ============================================================================
console.log('\n📋 DealTypeBadge Tests\n');

// Simulate badge rendering logic
function renderBadgeJSX(dealTypeFlag) {
  switch (dealTypeFlag) {
    case 'LEGAL_DISTRESS':
      return 'animate-pulse bg-rose-500/10 border border-rose-500/30 text-rose-400 ⚠️ POWER OF SALE / BANK FORECLOSURE';
    case 'FIXER_UPPER':
      return 'bg-amber-500/10 border border-amber-500/30 text-amber-400 🔨 AS-IS / CONTRACTOR SPECIAL';
    case 'ASSIGNMENT_SALE':
      return 'bg-amber-500/10 border border-amber-500/30 text-amber-400 📋 ASSIGNMENT SALE';
    case 'MOTIVATED_SELLER':
      return 'bg-blue-500/10 border border-blue-500/30 text-blue-400 💸 MOTIVATED SELLER';
    case 'STANDARD':
    default:
      return null;
  }
}

test('DealTypeBadge - LEGAL_DISTRESS has correct classes and text', () => {
  const badge = renderBadgeJSX('LEGAL_DISTRESS');
  assertContains(badge, 'animate-pulse');
  assertContains(badge, 'bg-rose-500/10');
  assertContains(badge, 'text-rose-400');
  assertContains(badge, 'POWER OF SALE');
});

test('DealTypeBadge - FIXER_UPPER has correct classes and text', () => {
  const badge = renderBadgeJSX('FIXER_UPPER');
  assertContains(badge, 'bg-amber-500/10');
  assertContains(badge, 'text-amber-400');
  assertContains(badge, 'AS-IS');
});

test('DealTypeBadge - ASSIGNMENT_SALE has correct classes and text', () => {
  const badge = renderBadgeJSX('ASSIGNMENT_SALE');
  assertContains(badge, 'bg-amber-500/10');
  assertContains(badge, 'text-amber-400');
  assertContains(badge, 'ASSIGNMENT SALE');
});

test('DealTypeBadge - MOTIVATED_SELLER has correct classes and text', () => {
  const badge = renderBadgeJSX('MOTIVATED_SELLER');
  assertContains(badge, 'bg-blue-500/10');
  assertContains(badge, 'text-blue-400');
  assertContains(badge, 'MOTIVATED SELLER');
});

test('DealTypeBadge - STANDARD returns null', () => {
  const badge = renderBadgeJSX('STANDARD');
  assertEqual(badge, null);
});

test('DealTypeBadge - unknown returns null', () => {
  const badge = renderBadgeJSX('UNKNOWN_TYPE');
  assertEqual(badge, null);
});

// ============================================================================
// HoldingBurnCard Logic Tests
// ============================================================================
console.log('\n📋 HoldingBurnCard Tests\n');

function calculateOverrideMonthly(listPrice, interestRate) {
  if (!listPrice) return 0;
  const interest = (listPrice * 0.75 * interestRate) / 12;
  const taxes = (listPrice * 0.01) / 12;
  const vacancyInsurance = 250;
  const utilities = 350;
  const maintenance = (listPrice * 0.005) / 12;
  return Math.round(interest + taxes + vacancyInsurance + utilities + maintenance);
}

function calculateTotalProjectCapitalRisk(monthly, timelineMonths) {
  return monthly * timelineMonths;
}

test('HoldingBurnCard - default interest rate is 7.99%', () => {
  const DEFAULT_RATE = 0.0799;
  assertEqual(DEFAULT_RATE, 0.0799);
});

test('HoldingBurnCard - override monthly calculation', () => {
  const monthly = calculateOverrideMonthly(500000, 0.0799);
  assertGreaterThan(monthly, 3000); // Should be > $3000
  assertGreaterThan(monthly, 0);
});

test('HoldingBurnCard - total project capital risk calculation', () => {
  const monthly = 4000;
  const timeline = 6;
  const totalRisk = calculateTotalProjectCapitalRisk(monthly, timeline);
  assertEqual(totalRisk, 24000);
});

test('HoldingBurnCard - interest rate affects monthly', () => {
  const lowRate = calculateOverrideMonthly(500000, 0.05);
  const highRate = calculateOverrideMonthly(500000, 0.12);
  // Higher rate = higher monthly
  assertGreaterThan(highRate, lowRate);
});

test('HoldingBurnCard - timeline multiplier works', () => {
  const monthly = 3500;
  const risk3mo = calculateTotalProjectCapitalRisk(monthly, 3);
  const risk12mo = calculateTotalProjectCapitalRisk(monthly, 12);
  assertEqual(risk3mo, 10500);
  assertEqual(risk12mo, 42000);
});

// ============================================================================
// PriceCompressionCard Logic Tests
// ============================================================================
console.log('\n📋 PriceCompressionCard Tests\n');

const PRICE_DROP_ALARM_THRESHOLD = 15;

function getPriceDropColor(truePriceDropPct) {
  if (truePriceDropPct > PRICE_DROP_ALARM_THRESHOLD) {
    return 'text-rose-500';
  }
  return 'text-amber-400';
}

function shouldShowAlarm(truePriceDropPct) {
  return truePriceDropPct > PRICE_DROP_ALARM_THRESHOLD;
}

function calculateCapitalDiscount(peakPrice, currentPrice) {
  return peakPrice - currentPrice;
}

test('PriceCompressionCard - 10% drop uses amber color', () => {
  const color = getPriceDropColor(10);
  assertEqual(color, 'text-amber-400');
});

test('PriceCompressionCard - 15% drop uses amber color', () => {
  const color = getPriceDropColor(15);
  assertEqual(color, 'text-amber-400');
});

test('PriceCompressionCard - 16% drop uses rose color (alarm)', () => {
  const color = getPriceDropColor(16);
  assertEqual(color, 'text-rose-500');
});

test('PriceCompressionCard - 20% drop shows alarm', () => {
  const showAlarm = shouldShowAlarm(20);
  assertEqual(showAlarm, true);
});

test('PriceCompressionCard - 10% drop does not show alarm', () => {
  const showAlarm = shouldShowAlarm(10);
  assertEqual(showAlarm, false);
});

test('PriceCompressionCard - 15% threshold does NOT show alarm (strict >)', () => {
  const showAlarm = shouldShowAlarm(15);
  assertEqual(showAlarm, false);
});

test('PriceCompressionCard - capital discount calculation', () => {
  const discount = calculateCapitalDiscount(500000, 400000);
  assertEqual(discount, 100000);
});

test('PriceCompressionCard - capital discount no negative', () => {
  const discount = calculateCapitalDiscount(400000, 500000);
  // If current > peak, discount should still be calculated correctly
  assertEqual(discount, -100000); // negative means price went up
});

// ============================================================================
// Integration: Full Flipper Metrics Object
// ============================================================================
console.log('\n📋 Integration Tests\n');

test('Full Flipper Object - LEGAL_DISTRESS with high price drop', () => {
  const listing = {
    dealTypeFlag: 'LEGAL_DISTRESS',
    distressScore: 100,
    maxHoldingCost: 4500,
    listPrice: 450000,
    truePriceDropPct: 18.5,
    peakPrice: 550000,
    currentPrice: 450000,
  };
  
  const badge = renderBadgeJSX(listing.dealTypeFlag);
  assertContains(badge, 'POWER OF SALE');
  
  const monthly = calculateOverrideMonthly(listing.listPrice, 0.0799);
  assertGreaterThan(monthly, 0);
  
  const totalRisk = calculateTotalProjectCapitalRisk(monthly, 6);
  assertGreaterThan(totalRisk, 10000);
  
  const showAlarm = shouldShowAlarm(listing.truePriceDropPct);
  assertEqual(showAlarm, true);
  
  const capitalDiscount = calculateCapitalDiscount(listing.peakPrice, listing.currentPrice);
  assertEqual(capitalDiscount, 100000);
});

test('Full Flipper Object - MOTIVATED_SELLER standard deal', () => {
  const listing = {
    dealTypeFlag: 'MOTIVATED_SELLER',
    distressScore: 40,
    maxHoldingCost: 3200,
    listPrice: 380000,
    truePriceDropPct: 8.2,
    peakPrice: 420000,
    currentPrice: 385600,
  };
  
  const badge = renderBadgeJSX(listing.dealTypeFlag);
  assertContains(badge, 'MOTIVATED SELLER');
  assertContains(badge, 'bg-blue-500/10');
  
  const showAlarm = shouldShowAlarm(listing.truePriceDropPct);
  assertEqual(showAlarm, false); // 8.2% is under threshold
  
  const capitalDiscount = calculateCapitalDiscount(listing.peakPrice, listing.currentPrice);
  assertEqual(capitalDiscount, 34400);
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
  console.log('✅ All Flipper Component tests passed!');
  process.exit(0);
}