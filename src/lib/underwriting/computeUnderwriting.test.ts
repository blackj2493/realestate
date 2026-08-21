import { describe, it, expect } from "vitest";
import {
  computeUnderwriting,
  seedAssumptions,
  defaultStrategy,
  SUITE_CONVERSION_COST,
  type UnderwritingAssumptions,
} from "./computeUnderwriting";

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

  // The consequence of the two tests above, stated outright. It is the reason the
  // sandbox tiles carry an "incl. other income" qualifier: on screen this pair reads as
  // impossible, because NOI is normally rent minus costs, so a cap rate sits BELOW the
  // gross yield. A reader with no sight of the Other Income slider (it lives under
  // "Advanced", collapsed) has nothing to explain the inversion.
  it("cap rate can EXCEED gross yield once other income is underwritten", () => {
    const withSuite = computeUnderwriting(
      baseAssumptions({ purchasePrice: 1_000_000, monthlyRent: 3000, otherMonthlyIncome: 1500 })
    );
    expect(withSuite.capRatePct).toBeGreaterThan(withSuite.grossYieldPct);
  });

  it("cap rate stays BELOW gross yield on rent alone — the normal relationship", () => {
    const rentOnly = computeUnderwriting(
      baseAssumptions({
        purchasePrice: 1_000_000, monthlyRent: 3000, otherMonthlyIncome: 0,
        annualTaxes: 6000, opexPct: 8, vacancyPct: 5,
      })
    );
    expect(rentOnly.capRatePct).toBeLessThan(rentOnly.grossYieldPct);
  });

  it("returns 0 grossYieldPct when price is 0 (no division by zero)", () => {
    const result = computeUnderwriting(baseAssumptions({ purchasePrice: 0, monthlyRent: 3000 }));
    expect(result.grossYieldPct).toBe(0);
  });
});

// ── Rental strategy (migration 125) ─────────────────────────────────────────────
describe('rental strategy', () => {
  const listing = { listPrice: 900_000, annualTaxes: 5_400, monthlyFees: 0, compMonthlyRent: 3_000 };

  it('opens on the split when a suite is observed', () => {
    expect(defaultStrategy(1_500)).toBe('split');
  });

  it('never opens on add-suite — it costs money nobody has spent', () => {
    expect(defaultStrategy(null)).toBe('whole-home');
    expect(defaultStrategy(0)).toBe('whole-home');
  });

  it('gives the whole-home strategy no suite income, even when a comp exists', () => {
    const a = seedAssumptions({ ...listing, suiteMonthlyRent: 1_500, strategy: 'whole-home' });
    expect(a.otherMonthlyIncome).toBe(0);
    expect(a.suiteCapex).toBe(0);
  });

  it('seeds the split from the measured suite comp, not a constant', () => {
    const a = seedAssumptions({ ...listing, suiteMonthlyRent: 1_875, strategy: 'split' });
    expect(a.otherMonthlyIncome).toBe(1_875);
    expect(a.suiteCapex).toBe(0);
  });

  it('earns nothing on the split when no suite comp answered', () => {
    // "No cohort" must look exactly like "no suite" — the $1,500 constant is what
    // filling that hole with a guess produced.
    expect(seedAssumptions({ ...listing, suiteMonthlyRent: null, strategy: 'split' }).otherMonthlyIncome).toBe(0);
  });

  it('puts the conversion cost into cash invested on add-suite', () => {
    // Cashflow-positive on purpose — see the next test for why the sign matters.
    const cheap = { listPrice: 400_000, annualTaxes: 3_200, monthlyFees: 0, compMonthlyRent: 3_000 };
    const a = seedAssumptions({ ...cheap, suiteMonthlyRent: 1_500, strategy: 'add-suite' });
    expect(a.suiteCapex).toBe(SUITE_CONVERSION_COST.typical);

    const built = computeUnderwriting(a);
    const free = computeUnderwriting({ ...a, suiteCapex: 0 });
    expect(built.monthlyCashflow).toBeGreaterThan(0);
    expect(built.totalCashInvested - free.totalCashInvested).toBe(SUITE_CONVERSION_COST.typical);
    // Same income, more capital in — the return must fall, not stay put.
    expect(built.cashOnCashPct).toBeLessThan(free.cashOnCashPct);
    expect(built.monthlyCashflow).toBe(free.monthlyCashflow);
  });

  it('documents the sign trap: on a cash-NEGATIVE deal, more capital RAISES cash-on-cash', () => {
    // -$727/mo over $198k reads -4.41%; the same loss over $273k reads -3.20%. The
    // ratio improves while the deal does not. Pinned so nobody "fixes" it into a
    // guarantee that capex always lowers the number, and so any surface that ranks on
    // cash-on-cash knows it must not do so across the sign.
    const a = seedAssumptions({ ...listing, suiteMonthlyRent: 1_500, strategy: 'add-suite' });
    const built = computeUnderwriting(a);
    const free = computeUnderwriting({ ...a, suiteCapex: 0 });
    expect(built.monthlyCashflow).toBeLessThan(0);
    expect(built.cashOnCashPct).toBeGreaterThan(free.cashOnCashPct);
  });

  it('leaves capex out of the mortgage and the cap rate', () => {
    const a = seedAssumptions({ ...listing, suiteMonthlyRent: 1_500, strategy: 'add-suite' });
    const built = computeUnderwriting(a);
    const free = computeUnderwriting({ ...a, suiteCapex: 0 });
    expect(built.capRatePct).toBe(free.capRatePct);
    expect(built.monthlyMortgage).toBe(free.monthlyMortgage);
  });
});
