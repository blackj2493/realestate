import { describe, it, expect } from 'vitest';
import {
  calculateMonthlyMortgage,
  calculateBurnRate,
  calculateProForma,
} from './ExtrapolatedCapRateEngine';

describe('calculateMonthlyMortgage', () => {
  it('returns 0 when principal/rate/years is non-positive', () => {
    expect(calculateMonthlyMortgage(0, 0.05, 30)).toBe(0);
    expect(calculateMonthlyMortgage(100_000, 0, 30)).toBe(0);
    expect(calculateMonthlyMortgage(100_000, 0.05, 0)).toBe(0);
    expect(calculateMonthlyMortgage(-100_000, 0.05, 30)).toBe(0);
  });

  it('uses Canadian semi-annual compounding — $500k @ 5% / 30yr ≈ $2,668.45/mo', () => {
    // Lower than the US-style $2,684.11 by ~$15/mo because Canadian compounds
    // less frequently → slightly lower effective monthly rate. See
    // @/lib/finance/canadianMortgage for the canonical formula + dedicated tests.
    const monthly = calculateMonthlyMortgage(500_000, 0.05, 30);
    expect(monthly).toBeCloseTo(2668.45, 1);
  });
});

describe('calculateBurnRate', () => {
  it('returns 0 when list price is non-positive', () => {
    expect(
      calculateBurnRate({ listPrice: 0, taxAnnualAmount: 5000, associationFee: 0 })
    ).toBe(0);
  });

  it('falls back to 1% of list price when taxes are missing or zero', () => {
    const withTaxes = calculateBurnRate({
      listPrice: 800_000,
      taxAnnualAmount: 8_000,
      associationFee: 0,
    });
    const noTaxes = calculateBurnRate({
      listPrice: 800_000,
      taxAnnualAmount: null,
      associationFee: 0,
    });
    const zeroTaxes = calculateBurnRate({
      listPrice: 800_000,
      taxAnnualAmount: 0,
      associationFee: 0,
    });
    // 1% of 800k = $8k annual → identical to passing 8k explicitly.
    expect(noTaxes).toBeCloseTo(withTaxes, 2);
    expect(zeroTaxes).toBeCloseTo(withTaxes, 2);
  });

  it('adds association fee dollar-for-dollar', () => {
    const noFee = calculateBurnRate({
      listPrice: 800_000,
      taxAnnualAmount: 8_000,
      associationFee: 0,
    });
    const withFee = calculateBurnRate({
      listPrice: 800_000,
      taxAnnualAmount: 8_000,
      associationFee: 600,
    });
    expect(withFee - noFee).toBeCloseTo(600, 2);
  });
});

describe('calculateProForma', () => {
  it('returns a zero shape for null / undefined / <=0 listPrice', () => {
    const zero = {
      total_capital_basis: 0,
      pro_forma_noi: 0,
      extrapolated_cap_rate: 0,
      capital_burn_rate_monthly: 0,
    };
    expect(calculateProForma(null)).toEqual(zero);
    expect(calculateProForma(undefined)).toEqual(zero);
    expect(calculateProForma(0)).toEqual(zero);
    expect(calculateProForma(-1)).toEqual(zero);
  });

  it('caps extrapolated_cap_rate at 20% even on absurdly cheap inputs', () => {
    const r = calculateProForma(1);
    expect(r.extrapolated_cap_rate).toBeLessThanOrEqual(20);
  });

  it('matches the documented breakdown for a $500k input', () => {
    // From the comment block in the source:
    //   closing 2%, capex 120k, holding = price * 0.09/12 * 4
    //   GPR = 5500 * 12 * 0.95 = 62700; NOI = GPR * 0.75 = 47025
    const r = calculateProForma(500_000);
    const expectedClosing = 500_000 * 0.02; // 10_000
    const expectedHolding = (500_000 * (0.09 / 12)) * 4; // 15_000
    const expectedBasis = 500_000 + expectedClosing + 120_000 + expectedHolding;
    expect(r.total_capital_basis).toBeCloseTo(expectedBasis, 0);
    expect(r.pro_forma_noi).toBeCloseTo(47_025, 0);
    const expectedCapRate = (47_025 / expectedBasis) * 100;
    expect(r.extrapolated_cap_rate).toBeCloseTo(expectedCapRate, 1);
  });

  it('larger list price → smaller cap rate (NOI is constant, basis grows)', () => {
    const small = calculateProForma(500_000);
    const big = calculateProForma(2_000_000);
    expect(big.extrapolated_cap_rate).toBeLessThan(small.extrapolated_cap_rate);
  });
});
