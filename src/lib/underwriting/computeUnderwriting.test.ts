import { describe, it, expect } from "vitest";
import { computeUnderwriting, type UnderwritingAssumptions } from "./computeUnderwriting";

/** Minimal assumption set — only override what the test cares about. */
function baseAssumptions(overrides: Partial<UnderwritingAssumptions> = {}): UnderwritingAssumptions {
  return {
    purchasePrice: 0,
    downPaymentPct: 20,
    interestRatePct: 5.5,
    amortYears: 30,
    annualTaxes: 0,
    monthlyFees: 0,
    monthlyRent: 0,
    otherMonthlyIncome: 0,
    vacancyPct: 0,
    opexPct: 0,
    insuranceMonthly: 0,
    closingCostPct: 0,
    ...overrides,
  };
}

describe("computeUnderwriting — Gross Yield (audit MEDIUM-12)", () => {
  it("grossYieldPct is rent-only (3,000 × 12 / 1,000,000 = 3.6%), not inflated by otherMonthlyIncome", () => {
    const result = computeUnderwriting(
      baseAssumptions({
        purchasePrice: 1_000_000,
        monthlyRent: 3000,
        otherMonthlyIncome: 1500, // hypothetical suite income — must NOT inflate headline yield
      })
    );

    // Headline yield = annual RENT / price = 36,000 / 1,000,000 = 3.6%
    expect(result.grossYieldPct).toBe(3.6);
  });

  it("grossMonthlyIncome still includes otherMonthlyIncome (NOI/cashflow semantics unchanged)", () => {
    const result = computeUnderwriting(
      baseAssumptions({
        purchasePrice: 1_000_000,
        monthlyRent: 3000,
        otherMonthlyIncome: 1500,
      })
    );

    // grossMonthlyIncome feeds effectiveGrossIncome → NOI → cashflow; must remain 4,500
    expect(result.grossMonthlyIncome).toBe(4500);
  });

  it("returns 0 grossYieldPct when price is 0 (no division by zero)", () => {
    const result = computeUnderwriting(baseAssumptions({ purchasePrice: 0, monthlyRent: 3000 }));
    expect(result.grossYieldPct).toBe(0);
  });
});
