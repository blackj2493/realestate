/**
 * Shadow MLS - Extrapolated Cap Rate Engine (Phase 3)
 * 
 * Calculates the "Stabilized Yield on Cost" (Extrapolated Cap Rate) and
 * "Total Capital Basis" for every listing.
 * 
 * This module bypasses retail metrics (Current NOI / Purchase Price) and
 * calculates institutional value-add metrics using System Default Assumptions.
 * 
 * Output cap rates are stored as whole numbers (e.g., 8.25 for 8.25%) to
 * simplify frontend slider filtering. This avoids parsing leading zeros
 * (>0.08) in Typesense filter expressions.
 */

import { calculateCanadianMonthlyMortgage } from '@/lib/finance/canadianMortgage';

// ============================================================================
// Output Interface
// ============================================================================

/**
 * Pro Forma metrics for institutional value-add analysis.
 * All monetary values are in CAD dollars.
 */
export interface ProFormaMetrics {
  /** Total capital invested (list price + closing costs + capex + holding costs) */
  total_capital_basis: number;
  
  /** Pro forma Net Operating Income after vacancy and opex */
  pro_forma_noi: number;
  
  /** Extrapolated cap rate as percentage (e.g., 8.25 for 8.25%) */
  extrapolated_cap_rate: number;
  
  /** Monthly capital burn rate (mortgage + taxes + HOA + insurance) */
  capital_burn_rate_monthly: number;
}

/**
 * Input parameters for burn rate calculation.
 */
export interface BurnRateInput {
  /** Listing purchase price in CAD */
  listPrice: number;
  
  /** Annual property taxes (null if unknown) */
  taxAnnualAmount: number | null;
  
  /** Monthly association/condo fee (null if unknown) */
  associationFee: number | null;
}

// ============================================================================
// System Default Assumptions (Ontario Value-Add Baseline)
// ============================================================================

/**
 * Standard Ontario basement conversion costs (upper + lower unit).
 * Includes: permits, mechanical, electrical, plumbing, drywall, flooring.
 */
const DEFAULT_CAPEX = 120_000;

/**
 * Hard money / bridge debt interest rate (9% annually).
 */
const DEFAULT_BRIDGE_RATE = 0.09;

/**
 * Typical timeline from purchase to lease-up (4 months).
 */
const DEFAULT_TIMELINE_MONTHS = 4;

/**
 * Expected vacancy during lease-up period (5%).
 */
const DEFAULT_VACANCY_RATE = 0.05;

/**
 * Operating expense ratio (taxes, insurance, maintenance, management).
 * 25% is conservative for residential multi-unit.
 */
const DEFAULT_OPEX_RATIO = 0.25;

/**
 * Gross potential rent per month:
 * - Upper unit: $3,500/month
 * - Lower unit: $2,000/month
 * - Total: $5,500/month
 * 
 * Note: This static baseline will be upgraded to dynamic AVM in later phases.
 */
const DEFAULT_GPR_MONTHLY = 5_500;

/**
 * Maximum cap rate to prevent data anomalies on mispriced land deals.
 * 20% is a reasonable upper bound for stabilized yield on cost.
 */
const MAX_CAP_RATE = 20;

/**
 * Mortgage defaults for burn rate calculation.
 */
const DEFAULT_LTV = 0.80;            // 80% loan-to-value
const DEFAULT_ANNUAL_RATE = 0.05;   // 5% annual interest rate
const DEFAULT_AMORT_YEARS = 30;     // 30-year amortization
const DEFAULT_INSURANCE_MO = 150;   // $150/month homeowners insurance

// ============================================================================
// Mortgage Helper Functions
// ============================================================================

/**
 * Monthly mortgage payment under Canadian semi-annual compounding (the
 * legally-mandated convention; see @/lib/finance/canadianMortgage).
 * Takes YEARS — the helper takes months, so we multiply.
 */
export function calculateMonthlyMortgage(
  principal: number,
  annualRate: number,
  years: number
): number {
  return calculateCanadianMonthlyMortgage(principal, annualRate, years * 12);
}

/**
 * Calculates the institutional-grade monthly capital burn rate.
 * 
 * Components:
 * - Mortgage payment (80% LTV, 5%, 30yr amortized)
 * - Property taxes (monthly)
 * - HOA/condo fees (monthly)
 * - Homeowners insurance (monthly)
 * 
 * @param input - Burn rate input parameters
 * @returns Monthly capital burn rate in CAD
 */
export function calculateBurnRate(input: BurnRateInput): number {
  const { listPrice, taxAnnualAmount, associationFee } = input;
  
  // ── Step 1: Calculate Principal (Loan Amount) ────────────────────────────
  // Standard 80% LTV for investor financing
  if (listPrice <= 0) return 0;
  
  const loanAmount = listPrice * DEFAULT_LTV;
  
  // ── Step 2: Calculate Monthly Mortgage Payment ──────────────────────────
  const mortgageMo = calculateMonthlyMortgage(
    loanAmount,
    DEFAULT_ANNUAL_RATE,
    DEFAULT_AMORT_YEARS
  );
  
  // ── Step 3: Calculate Monthly Taxes ─────────────────────────────────────
  // Aggressive null protection: if tax data is missing, estimate at 1% of list price
  // This prevents artificially low burn rates from incomplete MLS data
  const effectiveAnnualTaxes = (taxAnnualAmount === null || taxAnnualAmount === undefined || taxAnnualAmount === 0)
    ? listPrice * 0.01  // 1% estimate for Ontario properties
    : taxAnnualAmount;
  const taxesMo = effectiveAnnualTaxes / 12;
  
  // ── Step 4: Calculate Monthly HOA/Association Fee ─────────────────────────
  const condoFeeMo = associationFee ?? 0;
  
  // ── Step 5: Calculate Total Burn Rate ─────────────────────────────────────
  const totalBurnRate = mortgageMo + taxesMo + condoFeeMo + DEFAULT_INSURANCE_MO;
  
  return Math.round(totalBurnRate * 100) / 100;
}

// ============================================================================
// Calculation Logic
// ============================================================================

/**
 * Calculates Pro Forma metrics for a given list price with optional burn rate.
 * 
 * @param listPrice - The listing purchase price in CAD
 * @param burnRateInput - Optional burn rate input (taxes, association fee) for capital burn calculation
 * @returns ProFormaMetrics with total_capital_basis, pro_forma_noi, extrapolated_cap_rate, and capital_burn_rate_monthly
 * 
 * @example
 * ```typescript
 * const metrics = calculateProForma(850000);
 * // metrics.total_capital_basis = 1034700
 * // metrics.pro_forma_noi = 54450
 * // metrics.extrapolated_cap_rate = 5.26
 * // metrics.capital_burn_rate_monthly = 4721.67
 * ```
 */
export function calculateProForma(
  listPrice: number | null | undefined,
  burnRateInput?: BurnRateInput
): ProFormaMetrics {
  // ── Null/Zero Safety Check ───────────────────────────────────────────────
  if (listPrice === null || listPrice === undefined || listPrice <= 0) {
    return {
      total_capital_basis: 0,
      pro_forma_noi: 0,
      extrapolated_cap_rate: 0,
      capital_burn_rate_monthly: 0,
    };
  }

  // ── Step 1: Calculate Closing Costs ──────────────────────────────────────
  // Ontario Land Transfer Tax (1.5-3%) + Legal fees (~$5,000)
  // Using 2% as baseline approximation
  const closingCosts = listPrice * 0.02;

  // ── Step 2: Calculate Holding Costs ──────────────────────────────────────
  // Bridge loan interest over holding period
  // Formula: listPrice * (annual_rate / 12) * months
  const holdingCosts = (listPrice * (DEFAULT_BRIDGE_RATE / 12)) * DEFAULT_TIMELINE_MONTHS;

  // ── Step 3: Calculate Total Capital Basis ────────────────────────────────
  // Total investment = Purchase + Closing + Capex + Holding
  const totalCapitalBasis = listPrice + closingCosts + DEFAULT_CAPEX + holdingCosts;

  // ── Step 4: Calculate Pro Forma NOI ─────────────────────────────────────
  // Gross Annual Rent: $5,500/month * 12 months
  const grossAnnualRent = DEFAULT_GPR_MONTHLY * 12;
  
  // Apply vacancy adjustment
  const effectiveGrossIncome = grossAnnualRent * (1 - DEFAULT_VACANCY_RATE);
  
  // Apply opex ratio to get NOI
  const proFormaNoi = effectiveGrossIncome * (1 - DEFAULT_OPEX_RATIO);

  // ── Step 5: Calculate Extrapolated Cap Rate ──────────────────────────────
  // Cap rate = NOI / Total Capital Basis
  // Stored as percentage (e.g., 8.25 for 8.25%) for easier frontend filtering
  let extrapolatedCapRate = (proFormaNoi / totalCapitalBasis) * 100;
  
  // Cap at maximum to prevent data anomalies on land deals
  extrapolatedCapRate = Math.min(extrapolatedCapRate, MAX_CAP_RATE);

  // ── Step 6: Calculate Capital Burn Rate ─────────────────────────────────
  // Institutional-grade monthly carry cost (if input provided)
  const capitalBurnRateMonthly = burnRateInput
    ? calculateBurnRate(burnRateInput)
    : calculateBurnRate({ listPrice, taxAnnualAmount: null, associationFee: null });

  // ── Round to 2 decimal places for JSON payload optimization ────────────
  return {
    total_capital_basis: Math.round(totalCapitalBasis * 100) / 100,
    pro_forma_noi: Math.round(proFormaNoi * 100) / 100,
    extrapolated_cap_rate: Math.round(extrapolatedCapRate * 100) / 100,
    capital_burn_rate_monthly: capitalBurnRateMonthly,
  };
}

/**
 * Batch calculate Pro Forma metrics for multiple listings.
 * 
 * @param listings - Array of list prices
 * @returns Array of ProFormaMetrics (same order as input)
 */
export function calculateBatchProForma(listPrices: (number | null | undefined)[]): ProFormaMetrics[] {
  if (!Array.isArray(listPrices)) {
    console.warn('calculateBatchProForma: Expected array, received non-array input');
    return [];
  }
  
  return listPrices.map(listPrice => calculateProForma(listPrice));
}

// ============================================================================
// Test & Dev Helpers
// ============================================================================

/**
 * Runs comprehensive test cases for Pro Forma calculation.
 */
export function runProFormaTests(): void {
  console.log('\n🧪 Shadow MLS Extrapolated Cap Rate Engine Tests');
  console.log('='.repeat(60));

  // ── Test Case 1: Standard $850,000 Listing ──────────────────────────────
  const test1Price = 850_000;
  const result1 = calculateProForma(test1Price);
  console.log('\n💰 Test 1: Standard $850,000 Listing');
  console.log('   List Price: $850,000');
  console.log('   Result:', JSON.stringify(result1));
  console.assert(result1.total_capital_basis > test1Price, 'Capital basis should exceed list price');
  console.assert(result1.extrapolated_cap_rate > 0, 'Should have positive cap rate');
  console.assert(result1.extrapolated_cap_rate < MAX_CAP_RATE, 'Should be under max cap rate');

  // ── Test Case 2: Null List Price ─────────────────────────────────────────
  const result2 = calculateProForma(null);
  console.log('\n❌ Test 2: Null List Price');
  console.log('   Result:', JSON.stringify(result2));
  console.assert(result2.total_capital_basis === 0, 'Should return 0 for null');
  console.assert(result2.pro_forma_noi === 0, 'Should return 0 NOI for null');
  console.assert(result2.extrapolated_cap_rate === 0, 'Should return 0 cap rate for null');

  // ── Test Case 3: Zero List Price ─────────────────────────────────────────
  const result3 = calculateProForma(0);
  console.log('\n❌ Test 3: Zero List Price');
  console.log('   Result:', JSON.stringify(result3));
  console.assert(result3.total_capital_basis === 0, 'Should return 0 for zero');
  console.assert(result3.pro_forma_noi === 0, 'Should return 0 NOI for zero');
  console.assert(result3.extrapolated_cap_rate === 0, 'Should return 0 cap rate for zero');

  // ── Test Case 4: Undefined List Price ───────────────────────────────────
  const result4 = calculateProForma(undefined);
  console.log('\n❌ Test 4: Undefined List Price');
  console.log('   Result:', JSON.stringify(result4));
  console.assert(result4.total_capital_basis === 0, 'Should return 0 for undefined');

  // ── Test Case 5: Cheap Land Deal (High Cap Rate Scenario) ───────────────
  const test5Price = 200_000;
  const result5 = calculateProForma(test5Price);
  console.log('\n🏠 Test 5: Cheap Land Deal ($200,000)');
  console.log('   List Price: $200,000');
  console.log('   Result:', JSON.stringify(result5));
  console.assert(result5.extrapolated_cap_rate > result1.extrapolated_cap_rate, 
    'Cheaper property should have higher cap rate');

  // ── Test Case 6: Expensive Property (Lower Cap Rate) ────────────────────
  const test6Price = 2_000_000;
  const result6 = calculateProForma(test6Price);
  console.log('\n🏰 Test 6: Expensive Property ($2,000,000)');
  console.log('   List Price: $2,000,000');
  console.log('   Result:', JSON.stringify(result6));
  console.assert(result6.extrapolated_cap_rate < result1.extrapolated_cap_rate, 
    'Expensive property should have lower cap rate');

  // ── Test Case 7: Cap Rate Cap Validation ────────────────────────────────
  // Even a $1 property shouldn't return > 20% cap rate
  const result7 = calculateProForma(1);
  console.log('\n🎯 Test 7: Cap Rate Cap Validation ($1 property)');
  console.log('   List Price: $1');
  console.log('   Result:', JSON.stringify(result7));
  console.assert(result7.extrapolated_cap_rate <= MAX_CAP_RATE, 
    'Cap rate should be capped at 20%');

  // ── Test Case 8: Batch Processing ──────────────────────────────────────
  const batchPrices = [850_000, null, 0, 1_200_000, undefined];
  const batchResults = calculateBatchProForma(batchPrices);
  console.log('\n📦 Test 8: Batch Processing');
  console.log('   Input:', JSON.stringify(batchPrices));
  console.log('   Processed:', batchResults.length, 'listings');
  console.assert(batchResults.length === 5, 'Should process all 5 listings');
  console.assert(batchResults[0].extrapolated_cap_rate > 0, 'First should have valid cap rate');
  console.assert(batchResults[1].extrapolated_cap_rate === 0, 'Null should return 0 cap rate');
  console.assert(batchResults[2].extrapolated_cap_rate === 0, 'Zero should return 0 cap rate');

  // ── Test Case 9: Decimal Precision Check ────────────────────────────────
  const result9 = calculateProForma(777_777);
  console.log('\n🔢 Test 9: Decimal Precision Check');
  console.log('   List Price: $777,777');
  console.log('   Result:', JSON.stringify(result9));
  // Check that all values have at most 2 decimal places
  const hasValidPrecision = (n: number) => {
    const str = n.toString();
    const decimalIndex = str.indexOf('.');
    if (decimalIndex === -1) return true;
    return str.length - decimalIndex - 1 <= 2;
  };
  console.assert(hasValidPrecision(result9.total_capital_basis), 'Total capital basis should have max 2 decimal places');
  console.assert(hasValidPrecision(result9.pro_forma_noi), 'Pro forma NOI should have max 2 decimal places');
  console.assert(hasValidPrecision(result9.extrapolated_cap_rate), 'Cap rate should have max 2 decimal places');

  // ── Test Case 10: Verify Calculation Breakdown ───────────────────────────
  const testPrice = 500_000;
  const breakdown = calculateProForma(testPrice);
  const expectedClosing = testPrice * 0.02; // $10,000
  const expectedHolding = (testPrice * (0.09 / 12)) * 4; // $15,000
  const expectedCapitalBasis = testPrice + expectedClosing + 120_000 + expectedHolding; // $645,000
  const expectedGPR = 5_500 * 12 * 0.95; // $62,700 (with 5% vacancy)
  const expectedNOI = expectedGPR * 0.75; // $47,025 (with 25% opex)
  const expectedCapRate = (expectedNOI / expectedCapitalBasis) * 100; // ~7.29%
  
  console.log('\n📐 Test 10: Verify Calculation Breakdown ($500,000)');
  console.log('   Expected Capital Basis: $' + expectedCapitalBasis.toLocaleString());
  console.log('   Actual Capital Basis:   $' + breakdown.total_capital_basis.toLocaleString());
  console.assert(Math.abs(breakdown.total_capital_basis - expectedCapitalBasis) < 1, 
    'Capital basis calculation should be accurate');
  console.log('   Expected NOI: $' + Math.round(expectedNOI).toLocaleString());
  console.log('   Actual NOI:   $' + breakdown.pro_forma_noi.toLocaleString());
  console.log('   Expected Cap Rate: ' + expectedCapRate.toFixed(2) + '%');
  console.log('   Actual Cap Rate:   ' + breakdown.extrapolated_cap_rate + '%');
  console.assert(Math.abs(breakdown.extrapolated_cap_rate - expectedCapRate) < 0.1, 
    'Cap rate calculation should be accurate');

  console.log('\n' + '='.repeat(60));
  console.log('✅ All Pro Forma tests completed\n');
}

// Run if executed directly (Node only). Guarded so the engine can be imported into
// the client bundle — `module`/`require` don't exist in the browser.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  runProFormaTests();
}

export default calculateProForma;
