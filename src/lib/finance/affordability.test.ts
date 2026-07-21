import { describe, it, expect } from "vitest";
import { qualifyingRatePct, incomeToQualify } from "./affordability";

describe("qualifyingRatePct", () => {
  it("adds the 2% buffer when it beats the floor", () => {
    expect(qualifyingRatePct(5.5)).toBe(7.5);
    expect(qualifyingRatePct(6.0)).toBe(8.0);
  });

  it("falls back to the 5.25% floor for low contract rates", () => {
    expect(qualifyingRatePct(2.0)).toBe(5.25); // 2+2=4 < 5.25 → floor binds
    expect(qualifyingRatePct(3.25)).toBe(5.25); // exactly at the floor
  });
});

describe("incomeToQualify", () => {
  it("qualifies at the stress rate and back-solves GDS income", () => {
    const r = incomeToQualify({
      loanAmount: 719_200,
      contractRatePct: 5.5,
      amortYears: 25,
      annualPropertyTax: 4_200,
      monthlyCondoFees: 680,
    });
    expect(r.qualifyingRatePct).toBe(7.5); // stress-tested, not the 5.5% contract
    // P&I at 7.5%/25yr on 719.2k ≈ $5,262; housing adds tax/heat/50% fees.
    expect(r.qualifyingMonthlyPayment).toBeGreaterThan(5_200);
    expect(r.qualifyingMonthlyPayment).toBeLessThan(5_320);
    // With no other debt, GDS (39%) is the binding constraint.
    expect(r.bindingRatio).toBe("gds");
    expect(r.requiredAnnualIncome).toBeGreaterThan(184_000);
    expect(r.requiredAnnualIncome).toBeLessThan(188_000);
    expect(r.requiredAnnualIncome).toBe(r.incomeForGds);
  });

  it("flips to TDS when other debts are heavy enough", () => {
    const base = { loanAmount: 719_200, contractRatePct: 5.5, amortYears: 25, annualPropertyTax: 4_200, monthlyCondoFees: 680 };
    const noDebt = incomeToQualify(base);
    const withDebt = incomeToQualify({ ...base, monthlyOtherDebt: 2_000 });
    expect(withDebt.bindingRatio).toBe("tds");
    expect(withDebt.requiredAnnualIncome).toBe(withDebt.incomeForTds);
    expect(withDebt.requiredAnnualIncome).toBeGreaterThan(noDebt.requiredAnnualIncome);
  });

  it("handles the no-mortgage case (non-P&I housing costs only)", () => {
    const r = incomeToQualify({ loanAmount: 0, contractRatePct: 5.5, amortYears: 25, annualPropertyTax: 4_200, monthlyCondoFees: 680 });
    expect(r.qualifyingMonthlyPayment).toBe(0);
    // housing = 350 tax + 100 heat + 340 (50% of 680) = 790/mo → 9,480/yr / 0.39
    expect(r.monthlyHousingCost).toBe(790);
    expect(r.requiredAnnualIncome).toBe(Math.round((790 * 12) / 0.39));
  });

  it("never returns non-finite output for junk input", () => {
    const r = incomeToQualify({ loanAmount: NaN, contractRatePct: NaN, amortYears: NaN, annualPropertyTax: NaN });
    expect(Number.isFinite(r.requiredAnnualIncome)).toBe(true);
  });
});
