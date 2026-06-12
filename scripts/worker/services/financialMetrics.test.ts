import { describe, it, expect } from 'vitest';
import {
  calculateFinancialMetrics,
  type FinancialMetricsInput,
} from './financialMetrics';

const baseInput: FinancialMetricsInput = {
  annual_rent: 0,
  annual_rent_p10: 0,
  has_rent_data: false,
  calculation_price: 800_000,
  is_price_discovery: false,
  propertySubType: 'Detached',
  listPrice: 800_000,
  taxAnnualAmount: 6_000,
  associationFee: null,
  maintenanceExpense: null,
  insuranceExpense: null,
  baseMillRate: 0.009,
  multiUnitStatus: 'NONE',
  isCondo: false,
};

describe('calculateFinancialMetrics', () => {
  it('produces finite numbers (never NaN/Infinity) when there is no rent data', () => {
    const r = calculateFinancialMetrics(baseInput);
    for (const v of Object.values(r)) {
      if (typeof v === 'number') {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
    // Zero revenue → zero gross yield.
    expect(r.gross_yield_est).toBe(0);
    expect(r.annual_revenue).toBe(0);
  });

  it('uses mill-rate estimate when taxAnnualAmount is 0 or null', () => {
    const withTax = calculateFinancialMetrics({ ...baseInput, taxAnnualAmount: 6_000 });
    const noTax = calculateFinancialMetrics({ ...baseInput, taxAnnualAmount: null });
    const zeroTax = calculateFinancialMetrics({ ...baseInput, taxAnnualAmount: 0 });
    // Both fallbacks should land on the mill-rate estimate (price × baseMillRate),
    // which equals 800_000 × 0.009 = 7_200 — DIFFERENT from the explicit 6_000 input.
    expect(noTax.tax_burden_ratio).not.toBe(withTax.tax_burden_ratio);
    expect(zeroTax.tax_burden_ratio).not.toBe(withTax.tax_burden_ratio);
    expect(noTax.tax_burden_ratio).toBe(zeroTax.tax_burden_ratio);
  });

  it('clamps clearly bogus tax amounts (>5% of list price) to the mill-rate fallback', () => {
    const bogus = calculateFinancialMetrics({ ...baseInput, taxAnnualAmount: 60_000 });
    const millRateOnly = calculateFinancialMetrics({ ...baseInput, taxAnnualAmount: null });
    // 60k taxes on an 800k home is unreasonable → fallback applied; tax_burden_ratio
    // should equal the mill-rate-only path (price × baseMillRate / price × 100),
    // NOT the absurd 7.5% that would come from honoring the 60k literally.
    expect(bogus.tax_burden_ratio).toBe(millRateOnly.tax_burden_ratio);
    expect(bogus.tax_burden_ratio).not.toBeCloseTo(7.5, 1);
  });

  it('multiplies monthly tax input by 12 (the "looks like /mo" heuristic)', () => {
    // Anything <500 is treated as monthly. 400 * 12 = 4800 annual.
    const monthlyish = calculateFinancialMetrics({ ...baseInput, taxAnnualAmount: 400 });
    const annual = calculateFinancialMetrics({ ...baseInput, taxAnnualAmount: 4_800 });
    expect(monthlyish.tax_burden_ratio).toBeCloseTo(annual.tax_burden_ratio, 3);
  });

  it('flags an UNASSESSED status when taxAnnualAmount is exactly 0', () => {
    const r = calculateFinancialMetrics({ ...baseInput, taxAnnualAmount: 0 });
    expect(r.assessment_status).toBe('UNASSESSED');
  });

  it('returns a positive cap rate when rent data is present', () => {
    const r = calculateFinancialMetrics({
      ...baseInput,
      annual_rent: 36_000,
      annual_rent_p10: 30_000,
      has_rent_data: true,
    });
    expect(r.gross_yield_est).toBeGreaterThan(0);
    expect(r.annual_revenue).toBe(36_000);
    expect(Number.isFinite(r.cap_rate_est)).toBe(true);
    expect(Number.isFinite(r.net_monthly_cashflow)).toBe(true);
  });

  it('passes is_price_discovery through to price_discovery_flag verbatim', () => {
    const r = calculateFinancialMetrics({ ...baseInput, is_price_discovery: true });
    expect(r.price_discovery_flag).toBe(true);
  });

  it('condos get a lower insurance + maintenance baseline than freeholds', () => {
    const condo = calculateFinancialMetrics({
      ...baseInput,
      isCondo: true,
      associationFee: 0,
      annual_rent: 36_000,
      has_rent_data: true,
    });
    const freehold = calculateFinancialMetrics({
      ...baseInput,
      isCondo: false,
      annual_rent: 36_000,
      has_rent_data: true,
    });
    // Same revenue + price; condo has lower fixed opex → higher NOI/cashflow.
    expect(condo.annual_opex).toBeLessThan(freehold.annual_opex);
  });

  it('adds duplex utility carry of $3500/yr for freehold duplexes', () => {
    const detached = calculateFinancialMetrics({ ...baseInput, propertySubType: 'Detached' });
    const duplex = calculateFinancialMetrics({ ...baseInput, propertySubType: 'Duplex' });
    expect(duplex.annual_opex - detached.annual_opex).toBe(3_500);
  });

  it('protects against price=0 (uses price floor of 1 internally, no divide-by-zero)', () => {
    const r = calculateFinancialMetrics({ ...baseInput, calculation_price: 0, listPrice: 0 });
    expect(Number.isFinite(r.cap_rate_est)).toBe(true);
    expect(Number.isFinite(r.tax_burden_ratio)).toBe(true);
  });

  // audit LOW-10: when both prices are zero every ratio metric must be 0, not
  // astronomical (the old `price||1` fallback produced absurd cap rates on
  // zero-price records that slip through before the lease guard).
  it('LOW-10: zero-price record returns all ratio metrics as 0 (not astronomical)', () => {
    const r = calculateFinancialMetrics({
      ...baseInput,
      calculation_price: 0,
      listPrice: 0,
      annual_rent: 36_000,
      annual_rent_p10: 30_000,
      has_rent_data: true,
    });
    expect(r.cap_rate_est).toBe(0);
    expect(r.cap_rate_floor).toBe(0);
    expect(r.gross_yield_est).toBe(0);
    expect(r.tax_burden_ratio).toBe(0);
    expect(r.net_monthly_cashflow).toBe(0);
  });
});

describe('transaction-type guard (a for-lease listing has no purchase price)', () => {
  // On a for-lease listing, ListPrice is the MONTHLY RENT, not a sale price. Dividing
  // an annual-rent estimate by it yields absurd 1000%+ cap rates (the real defect that
  // contaminated 249/575 positive-cap docs in prod). Lease listings must yield zeros.
  const leaseLike: FinancialMetricsInput = {
    ...baseInput,
    transactionType: 'For Lease',
    listPrice: 1_750,           // the monthly rent, masquerading as a price
    calculation_price: 1_750,
    annual_rent: 26_400,        // cohort rent estimate (~$2,200/mo) from rentAVM
    annual_rent_p10: 24_000,
    has_rent_data: true,
  };

  it('zeroes price-relative metrics for a for-lease listing (no 1000%+ cap rate)', () => {
    const r = calculateFinancialMetrics(leaseLike);
    expect(r.cap_rate_est).toBe(0);
    expect(r.cap_rate_floor).toBe(0);
    expect(r.gross_yield_est).toBe(0);
    expect(r.net_monthly_cashflow).toBe(0);
    expect(r.cashflow_floor).toBe(0);
    expect(r.tax_burden_ratio).toBe(0);
  });

  it('treats "For Sub-Lease" as a lease too', () => {
    const r = calculateFinancialMetrics({ ...leaseLike, transactionType: 'For Sub-Lease' });
    expect(r.cap_rate_est).toBe(0);
  });

  it('still computes real metrics for an explicit "For Sale" listing', () => {
    const r = calculateFinancialMetrics({
      ...baseInput,
      transactionType: 'For Sale',
      annual_rent: 36_000,
      has_rent_data: true,
    });
    expect(r.cap_rate_est).not.toBe(0);
    expect(r.gross_yield_est).toBeGreaterThan(0);
  });

  it('treats a missing transactionType as a sale (no regression for sale listings)', () => {
    const r = calculateFinancialMetrics({
      ...baseInput,
      annual_rent: 36_000,
      has_rent_data: true,
    });
    expect(r.gross_yield_est).toBeGreaterThan(0);
  });
});

const BASE: FinancialMetricsInput = {
  annual_rent: 30_000,
  annual_rent_p10: 24_000,
  has_rent_data: true,
  calculation_price: 500_000,
  is_price_discovery: false,
  propertySubType: 'Detached',
  listPrice: 500_000,
  transactionType: 'For Sale',
  taxAnnualAmount: 4_000,
  associationFee: 0,
  maintenanceExpense: null,
  insuranceExpense: null,
  baseMillRate: 0.008,
  multiUnitStatus: 'NONE',
  isCondo: false,
};

describe('calculateFinancialMetrics — insurance single-count (audit HIGH-8)', () => {
  it('net_monthly_cashflow reconciles with its own returned components (no second insurance deduction)', () => {
    const m = calculateFinancialMetrics(BASE);
    // Spec: cashflow = grossRent*0.96 − mortgage − opex/12. Insurance is INSIDE
    // annual_opex; deducting it again (the bug) makes this off by $125/mo (freehold).
    const expected = (m.annual_revenue / 12) * 0.96 - (m.mortgage_monthly + m.annual_opex / 12);
    // Components are individually rounded to the dollar — allow ±$5; the bug is off by $125.
    expect(Math.abs(m.net_monthly_cashflow - expected)).toBeLessThanOrEqual(5);
  });

  it('condo variant reconciles too (bug delta would be $40/mo)', () => {
    const m = calculateFinancialMetrics({ ...BASE, isCondo: true, propertySubType: 'Condo Apartment', associationFee: 600 });
    const expected = (m.annual_revenue / 12) * 0.96 - (m.mortgage_monthly + m.annual_opex / 12);
    expect(Math.abs(m.net_monthly_cashflow - expected)).toBeLessThanOrEqual(5);
  });

  it('cashflow_floor matches the hand-derived spec value for BASE', () => {
    const m = calculateFinancialMetrics(BASE);
    /*
     * Hand-derived for BASE (isCondo=false, no association fee):
     *   annualRevenueP10 = 24_000 (has_rent_data=true, uses annual_rent_p10)
     *   vacancyLossFloor = 24_000 * 0.08 = 1_920
     *   grossRentNetVacancyFloor = 24_000 - 1_920 = 22_080
     *
     *   taxes = 4_000 (taxAnnualAmount supplied, >500, <5% of listPrice 500k)
     *   insurance = 1_500 (isCondo=false)
     *   maintenance = 500_000 * 0.01 = 5_000 (freehold rate)
     *   hoa = 0 * 12 = 0 (associationFee=0)
     *   managementFeeFloor = 24_000 * 0.10 = 2_400
     *   utilities = 0 (not Duplex)
     *   annualOpexFloor = 4_000 + (1_500*1.2) + (5_000*1.5) + 0 + 2_400 + 0
     *                   = 4_000 + 1_800 + 7_500 + 2_400 = 15_700
     *
     *   loanAmount = 500_000 * 0.80 = 400_000
     *   r = (1 + 0.0404/2)^(1/6) - 1 ≈ 0.0033387
     *   factor = (1+r)^360 ≈ 3.31986
     *   mortgageMonthly = 400_000 * (r * factor)/(factor - 1) ≈ 1911.14
     *
     * AFTER the fix (insurance deducted exactly once, already inside annualOpexFloor):
     *   cashflowFloorRaw = ((24_000/12) * 0.92) - (1911.14 + (15_700/12))
     *                    = (2_000 * 0.92) - (1911.14 + 1308.33)
     *                    = 1_840 - 3_219.47
     *                    = -1_379.47 → Math.round = -1_379
     *
     * Before the fix (double-counting insurance*1.2/12 = $150/mo):
     *   would be -1_379 - 150 = -1_529
     */
    expect(m.cashflow_floor).toBe(-1379);
  });
});
