import { describe, it, expect } from 'vitest';
import {
  canadianEffectiveMonthlyRate,
  calculateCanadianMonthlyMortgage,
} from './canadianMortgage';

describe('canadianEffectiveMonthlyRate', () => {
  it('matches the formula (1 + r/2)^(1/6) - 1 at 5%', () => {
    // Cross-check: 5% stated annual under semi-annual compounding
    // → r_monthly ≈ 0.004123915...
    expect(canadianEffectiveMonthlyRate(0.05)).toBeCloseTo(0.004123915, 8);
  });

  it('matches the formula at 0% (boundary)', () => {
    expect(canadianEffectiveMonthlyRate(0)).toBe(0);
  });

  it('is strictly less than the US-style annualRate/12 (the under-compounding tax)', () => {
    // Canadian compounds less frequently → effective monthly rate is LOWER than
    // a naive r/12. This is the structural reason a Canadian payment differs
    // from the US monthly-compounded one on identical inputs.
    for (const r of [0.03, 0.05, 0.07, 0.09]) {
      expect(canadianEffectiveMonthlyRate(r)).toBeLessThan(r / 12);
    }
  });
});

describe('calculateCanadianMonthlyMortgage — defensive zeros', () => {
  it('returns 0 for non-positive principal / rate / months', () => {
    expect(calculateCanadianMonthlyMortgage(0, 0.05, 300)).toBe(0);
    expect(calculateCanadianMonthlyMortgage(500_000, 0, 300)).toBe(0);
    expect(calculateCanadianMonthlyMortgage(500_000, 0.05, 0)).toBe(0);
    expect(calculateCanadianMonthlyMortgage(-1, 0.05, 300)).toBe(0);
    expect(calculateCanadianMonthlyMortgage(500_000, -0.05, 300)).toBe(0);
    expect(calculateCanadianMonthlyMortgage(500_000, 0.05, -1)).toBe(0);
  });
});

describe('calculateCanadianMonthlyMortgage — known values', () => {
  // Pinned to the precise output of the formula (1 + r/2)^(1/6) − 1 — the
  // legally-mandated Canadian compounding. Published calculators differ in
  // the 3rd–4th decimal because they apply intermediate rounding; we don't,
  // so these values are the mathematical truth to within floating-point.
  it('$500k @ 5.00% / 25yr → ~$2,908.02/mo', () => {
    expect(calculateCanadianMonthlyMortgage(500_000, 0.05, 300)).toBeCloseTo(
      2_908.02,
      1
    );
  });

  it('$500k @ 5.00% / 30yr → ~$2,668.45/mo', () => {
    expect(calculateCanadianMonthlyMortgage(500_000, 0.05, 360)).toBeCloseTo(
      2_668.45,
      1
    );
  });

  it('$500k @ 4.00% / 25yr → ~$2,630.10/mo', () => {
    expect(calculateCanadianMonthlyMortgage(500_000, 0.04, 300)).toBeCloseTo(
      2_630.10,
      1
    );
  });

  it('$500k @ 6.00% / 25yr → ~$3,199.03/mo', () => {
    expect(calculateCanadianMonthlyMortgage(500_000, 0.06, 300)).toBeCloseTo(
      3_199.03,
      1
    );
  });
});

describe('calculateCanadianMonthlyMortgage — structural properties', () => {
  it('payment scales linearly with principal', () => {
    const a = calculateCanadianMonthlyMortgage(400_000, 0.05, 300);
    const b = calculateCanadianMonthlyMortgage(800_000, 0.05, 300);
    expect(b / a).toBeCloseTo(2, 6);
  });

  it('higher rate → strictly higher payment', () => {
    const lo = calculateCanadianMonthlyMortgage(500_000, 0.04, 300);
    const hi = calculateCanadianMonthlyMortgage(500_000, 0.06, 300);
    expect(hi).toBeGreaterThan(lo);
  });

  it('longer amortization → strictly lower payment (same principal + rate)', () => {
    const short = calculateCanadianMonthlyMortgage(500_000, 0.05, 180); // 15yr
    const long = calculateCanadianMonthlyMortgage(500_000, 0.05, 360); // 30yr
    expect(long).toBeLessThan(short);
  });

  it('total interest paid > 0 (sanity: schedule fully amortizes)', () => {
    const monthly = calculateCanadianMonthlyMortgage(500_000, 0.05, 300);
    const totalPaid = monthly * 300;
    expect(totalPaid).toBeGreaterThan(500_000); // pays back principal + interest
    expect(totalPaid - 500_000).toBeGreaterThan(0); // interest is positive
  });
});
