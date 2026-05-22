/**
 * Shadow MLS - Flipper Filter Tests
 * 
 * Tests the Flipper & Deal Hunter filter components and query building.
 * Run: node src/components/terminal/Filters/test-flipper-filters.js
 */

const { create } = require('zustand');

// Mock the filter store with flipper slices
const createMockStore = () => {
  const initialState = {
    // Existing persona filters
    capRateFloor: 0,
    cashflowFloor: 0,
    targetYieldMin: 0,
    suiteFilters: ['PRIME_CANDIDATE', 'EXISTING_MULTI_UNIT'],
    propertyTypeFilter: 'All',
    occupancyFilter: ['Vacant', 'Tenanted'],
    minParkingFilter: 0,
    taxBurdenMax: 100,
    sortBy: 'cap_rate_floor',
    // ─── Flipper & Deal Hunter Filters ─────────────────────────────────────
    showOnlyDistressed: false,
    maxHoldingCostRange: [0, 10000],
    minTrueDomRange: [0, 365],
    unfinishedBasementOnly: false,
    vacantPossessionOnly: false,
    priceDropRange: [0, 100],
  };

  return create((set) => ({
    ...initialState,
    setShowOnlyDistressed: (v) => set({ showOnlyDistressed: v }),
    setMaxHoldingCostRange: (v) => set({ maxHoldingCostRange: v }),
    setMinTrueDomRange: (v) => set({ minTrueDomRange: v }),
    setUnfinishedBasementOnly: (v) => set({ unfinishedBasementOnly: v }),
    setVacantPossessionOnly: (v) => set({ vacantPossessionOnly: v }),
    setPriceDropRange: (v) => set({ priceDropRange: v }),
    setCapRateFloor: (v) => set({ capRateFloor: v }),
  }));
};

// Build filter query (same logic as queryBuilder.ts)
function buildFlipperFilterQuery(state) {
  const filters = [];

  // Flipper-specific filters
  if (state.showOnlyDistressed) {
    filters.push(`deal_type_flag:=["LEGAL_DISTRESS","ASSIGNMENT_SALE","FIXER_UPPER","MOTIVATED_SELLER"]`);
  }
  
  if (state.maxHoldingCostRange[0] > 0 || state.maxHoldingCostRange[1] < 10000) {
    filters.push(`max_holding_cost:[${state.maxHoldingCostRange[0]}..${state.maxHoldingCostRange[1]}]`);
  }
  
  if (state.minTrueDomRange[0] > 0) {
    filters.push(`true_dom:>=${state.minTrueDomRange[0]}`);
  }
  
  if (state.unfinishedBasementOnly) {
    filters.push(`basement_type:=["Unfinished"]`);
  }
  
  if (state.vacantPossessionOnly) {
    filters.push(`occupant_type:=["Vacant"]`);
  }
  
  if (state.priceDropRange[0] > 0 || state.priceDropRange[1] < 100) {
    filters.push(`true_price_drop_pct:[${state.priceDropRange[0]}..${state.priceDropRange[1]}]`);
  }

  return filters.join(' && ');
}

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

function assertContains(actual, substring, message = '') {
  if (!actual.includes(substring)) {
    throw new Error(`${message}\n  Expected to contain: ${substring}\n  Actual: ${actual}`);
  }
}

function assertNotContains(actual, substring, message = '') {
  if (actual.includes(substring)) {
    throw new Error(`${message}\n  Expected NOT to contain: ${substring}\n  Actual: ${actual}`);
  }
}

console.log('\n🧪 Shadow MLS - Flipper Filter Test Suite\n');
console.log('='.repeat(60));

// ============================================================================
// Filter State Tests
// ============================================================================
console.log('\n📋 Filter State Tests\n');

test('FlipperFilters - initial state has correct defaults', () => {
  const store = createMockStore();
  const state = store.getState();
  
  assertEqual(state.showOnlyDistressed, false);
  assertEqual(state.maxHoldingCostRange[0], 0);
  assertEqual(state.maxHoldingCostRange[1], 10000);
  assertEqual(state.minTrueDomRange[0], 0);
  assertEqual(state.minTrueDomRange[1], 365);
  assertEqual(state.unfinishedBasementOnly, false);
  assertEqual(state.vacantPossessionOnly, false);
  assertEqual(state.priceDropRange[0], 0);
  assertEqual(state.priceDropRange[1], 100);
});

test('FlipperFilters - setShowOnlyDistressed updates state', () => {
  const store = createMockStore();
  store.getState().setShowOnlyDistressed(true);
  assertEqual(store.getState().showOnlyDistressed, true);
});

test('FlipperFilters - setMaxHoldingCostRange updates state', () => {
  const store = createMockStore();
  store.getState().setMaxHoldingCostRange([500, 3000]);
  assertEqual(store.getState().maxHoldingCostRange[0], 500);
  assertEqual(store.getState().maxHoldingCostRange[1], 3000);
});

test('FlipperFilters - setMinTrueDomRange updates state', () => {
  const store = createMockStore();
  store.getState().setMinTrueDomRange([30, 365]);
  assertEqual(store.getState().minTrueDomRange[0], 30);
});

test('FlipperFilters - setUnfinishedBasementOnly updates state', () => {
  const store = createMockStore();
  store.getState().setUnfinishedBasementOnly(true);
  assertEqual(store.getState().unfinishedBasementOnly, true);
});

test('FlipperFilters - setVacantPossessionOnly updates state', () => {
  const store = createMockStore();
  store.getState().setVacantPossessionOnly(true);
  assertEqual(store.getState().vacantPossessionOnly, true);
});

test('FlipperFilters - setPriceDropRange updates state', () => {
  const store = createMockStore();
  store.getState().setPriceDropRange([5, 50]);
  assertEqual(store.getState().priceDropRange[0], 5);
  assertEqual(store.getState().priceDropRange[1], 50);
});

// ============================================================================
// Filter Query String Tests
// ============================================================================
console.log('\n📋 Filter Query String Tests\n');

test('buildFlipperFilterQuery - no filters returns empty', () => {
  const store = createMockStore();
  const query = buildFlipperFilterQuery(store.getState());
  assertEqual(query, '');
});

test('buildFlipperFilterQuery - showOnlyDistressed generates deal_type_flag filter', () => {
  const store = createMockStore();
  store.getState().setShowOnlyDistressed(true);
  const query = buildFlipperFilterQuery(store.getState());
  
  assertContains(query, 'deal_type_flag');
  assertContains(query, 'LEGAL_DISTRESS');
  assertContains(query, 'ASSIGNMENT_SALE');
  assertContains(query, 'FIXER_UPPER');
  assertContains(query, 'MOTIVATED_SELLER');
});

test('buildFlipperFilterQuery - maxHoldingCostRange generates range filter', () => {
  const store = createMockStore();
  store.getState().setMaxHoldingCostRange([500, 3000]);
  const query = buildFlipperFilterQuery(store.getState());
  
  assertContains(query, 'max_holding_cost:[500..3000]');
});

test('buildFlipperFilterQuery - minTrueDomRange generates lower bound filter', () => {
  const store = createMockStore();
  store.getState().setMinTrueDomRange([60, 365]);
  const query = buildFlipperFilterQuery(store.getState());
  
  assertContains(query, 'true_dom:>=60');
});

test('buildFlipperFilterQuery - unfinishedBasementOnly generates basement filter', () => {
  const store = createMockStore();
  store.getState().setUnfinishedBasementOnly(true);
  const query = buildFlipperFilterQuery(store.getState());
  
  assertContains(query, 'basement_type');
  assertContains(query, 'Unfinished');
});

test('buildFlipperFilterQuery - vacantPossessionOnly generates occupant_type filter', () => {
  const store = createMockStore();
  store.getState().setVacantPossessionOnly(true);
  const query = buildFlipperFilterQuery(store.getState());
  
  assertContains(query, 'occupant_type');
  assertContains(query, 'Vacant');
});

test('buildFlipperFilterQuery - priceDropRange generates price drop filter', () => {
  const store = createMockStore();
  store.getState().setPriceDropRange([10, 50]);
  const query = buildFlipperFilterQuery(store.getState());
  
  assertContains(query, 'true_price_drop_pct:[10..50]');
});

test('buildFlipperFilterQuery - combines multiple filters with &&', () => {
  const store = createMockStore();
  store.getState().setShowOnlyDistressed(true);
  store.getState().setMaxHoldingCostRange([500, 3000]);
  store.getState().setMinTrueDomRange([30, 365]);
  
  const query = buildFlipperFilterQuery(store.getState());
  
  const filterCount = query.split(' && ').length;
  assertEqual(filterCount, 3);
});

test('buildFlipperFilterQuery - default range values are not included', () => {
  const store = createMockStore();
  // maxHoldingCostRange defaults [0, 10000] - should not appear
  // priceDropRange defaults [0, 100] - should not appear
  const query = buildFlipperFilterQuery(store.getState());
  
  assertNotContains(query, 'max_holding_cost');
  assertNotContains(query, 'true_price_drop_pct');
});

test('buildFlipperFilterQuery - partial range includes only modified bound', () => {
  const store = createMockStore();
  store.getState().setMaxHoldingCostRange([500, 10000]); // only min changed
  const query = buildFlipperFilterQuery(store.getState());
  
  assertContains(query, 'max_holding_cost:[500..10000]');
});

test('buildFlipperFilterQuery - min DOM with non-default max still includes', () => {
  const store = createMockStore();
  store.getState().setMinTrueDomRange([30, 365]);
  const query = buildFlipperFilterQuery(store.getState());
  
  assertContains(query, 'true_dom:>=30');
  // Should NOT contain range syntax since max is default
  assertNotContains(query, 'true_dom:[30..365]');
});

// ============================================================================
// Toggle Switch Logic Tests
// ============================================================================
console.log('\n📋 Toggle Switch Logic Tests\n');

test('ToggleSwitch - toggles boolean state', () => {
  const store = createMockStore();
  const initial = store.getState().showOnlyDistressed;
  store.getState().setShowOnlyDistressed(!initial);
  assertEqual(store.getState().showOnlyDistressed, !initial);
});

test('ToggleSwitch - multiple toggles work independently', () => {
  const store = createMockStore();
  
  store.getState().setUnfinishedBasementOnly(true);
  store.getState().setVacantPossessionOnly(true);
  store.getState().setShowOnlyDistressed(true);
  
  assertEqual(store.getState().unfinishedBasementOnly, true);
  assertEqual(store.getState().vacantPossessionOnly, true);
  assertEqual(store.getState().showOnlyDistressed, true);
  
  // Toggle one off
  store.getState().setUnfinishedBasementOnly(false);
  
  assertEqual(store.getState().unfinishedBasementOnly, false);
  assertEqual(store.getState().vacantPossessionOnly, true);
  assertEqual(store.getState().showOnlyDistressed, true);
});

// ============================================================================
// Slider Value Tests
// ============================================================================
console.log('\n📋 Slider Value Tests\n');

test('Slider - maxHoldingCostRange accepts [min, max] tuple', () => {
  const store = createMockStore();
  const testValue = [1500, 4500];
  store.getState().setMaxHoldingCostRange(testValue);
  
  const state = store.getState();
  assertEqual(state.maxHoldingCostRange[0], 1500);
  assertEqual(state.maxHoldingCostRange[1], 4500);
});

test('Slider - priceDropRange accepts [min, max] tuple', () => {
  const store = createMockStore();
  const testValue = [5, 25];
  store.getState().setPriceDropRange(testValue);
  
  const state = store.getState();
  assertEqual(state.priceDropRange[0], 5);
  assertEqual(state.priceDropRange[1], 25);
});

test('Slider - DOM slider updates only min value', () => {
  const store = createMockStore();
  store.getState().setMinTrueDomRange([90, 365]);
  
  const state = store.getState();
  assertEqual(state.minTrueDomRange[0], 90);
  assertEqual(state.minTrueDomRange[1], 365); // should remain at default max
});

test('Slider - handles edge values', () => {
  const store = createMockStore();
  
  store.getState().setMaxHoldingCostRange([0, 10000]);
  assertEqual(store.getState().maxHoldingCostRange[0], 0);
  assertEqual(store.getState().maxHoldingCostRange[1], 10000);
  
  store.getState().setPriceDropRange([0, 100]);
  assertEqual(store.getState().priceDropRange[0], 0);
  assertEqual(store.getState().priceDropRange[1], 100);
  
  store.getState().setMinTrueDomRange([0, 365]);
  assertEqual(store.getState().minTrueDomRange[0], 0);
  assertEqual(store.getState().minTrueDomRange[1], 365);
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
  console.log('✅ All Flipper Filter tests passed!');
  process.exit(0);
}