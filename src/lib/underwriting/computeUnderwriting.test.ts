import { describe, it, expect } from "vitest";
import {
  computeUnderwriting,
  rentSeedForStrategy,
  rentOnStrategySwitch,
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

describe('rentSeedForStrategy', () => {
  const listing = { purchasePrice: 999_000, compMonthlyRent: 3_993, wholeHomeMonthlyRent: 4_800 };

  it('prices the whole house on whole-home and the main unit on split', () => {
    // W13714292: the ladder answers both, and they are 21% apart.
    expect(rentSeedForStrategy('whole-home', listing)).toBe(4_800);
    expect(rentSeedForStrategy('split', listing)).toBe(3_993);
  });

  it('leaves add-suite on the house as it stands', () => {
    // Nothing is built yet, so today's comp is the right anchor; the new suite arrives
    // as its own line with a build cost beside it.
    expect(rentSeedForStrategy('add-suite', listing)).toBe(3_993);
  });

  it('falls back to the comp when no whole-home figure exists', () => {
    // A document that predates the field must degrade to the old behaviour, not to 0.
    expect(rentSeedForStrategy('whole-home', { purchasePrice: 999_000, compMonthlyRent: 3_993 })).toBe(3_993);
    expect(rentSeedForStrategy('whole-home', { ...listing, wholeHomeMonthlyRent: 0 })).toBe(3_993);
    expect(rentSeedForStrategy('whole-home', { ...listing, wholeHomeMonthlyRent: null })).toBe(3_993);
  });

  it('never prices the whole house below its own main unit', () => {
    // Two cohorts, two depths: the ladder answered a 3-lease whole-home cohort below a
    // 7-lease main-unit one on a real 7+2 (-53%). Leasing the entire house cannot earn
    // less than leasing part of it, whatever the comps say.
    const inverted = { purchasePrice: 999_000, compMonthlyRent: 16_000, wholeHomeMonthlyRent: 7_500 };
    expect(rentSeedForStrategy('whole-home', inverted)).toBe(16_000);
    // Split is untouched by the floor — it is the main unit by definition.
    expect(rentSeedForStrategy('split', inverted)).toBe(16_000);
  });

  it('leaves an ordinary whole-home premium alone', () => {
    expect(rentSeedForStrategy('whole-home', { purchasePrice: 999_000, compMonthlyRent: 4_000, wholeHomeMonthlyRent: 4_250 })).toBe(4_250);
  });

  it('falls all the way back to the price rule when there is no comp at all', () => {
    expect(rentSeedForStrategy('whole-home', { purchasePrice: 500_000 })).toBe(2_000); // 0.004 x price
  });
});

describe('rentOnStrategySwitch', () => {
  const listing = { purchasePrice: 999_000, compMonthlyRent: 3_993, wholeHomeMonthlyRent: 4_800 };

  it('re-seeds an untouched field to the incoming strategy', () => {
    // THE BUG: this used to return 3_993 — a 7-bed house priced at its 4-bed comp.
    expect(rentOnStrategySwitch({ from: 'split', to: 'whole-home', currentRent: 3_993, ...listing })).toBe(4_800);
    expect(rentOnStrategySwitch({ from: 'whole-home', to: 'split', currentRent: 4_800, ...listing })).toBe(3_993);
  });

  it('keeps a rent the reader typed', () => {
    // They know something the ladder does not. Clobbering it is worse than a stale seed.
    expect(rentOnStrategySwitch({ from: 'split', to: 'whole-home', currentRent: 4_200, ...listing })).toBe(4_200);
  });

  it('is stable across a round trip, so toggling twice returns to where it started', () => {
    const there = rentOnStrategySwitch({ from: 'split', to: 'whole-home', currentRent: 3_993, ...listing });
    const back = rentOnStrategySwitch({ from: 'whole-home', to: 'split', currentRent: there, ...listing });
    expect(back).toBe(3_993);
  });

  it('changes nothing when the two strategies share a comp', () => {
    // A home with no observed suite: the main-unit lookup IS the whole-home one, so
    // there is no plus-room to strip and the switch must be a no-op.
    const noSuite = { purchasePrice: 999_000, compMonthlyRent: 4_800, wholeHomeMonthlyRent: 4_800 };
    expect(rentOnStrategySwitch({ from: 'whole-home', to: 'add-suite', currentRent: 4_800, ...noSuite })).toBe(4_800);
  });

  it('leaves a tuned field alone even when the incoming strategy has no figure', () => {
    const noWhole = { purchasePrice: 999_000, compMonthlyRent: 3_993 };
    expect(rentOnStrategySwitch({ from: 'split', to: 'whole-home', currentRent: 4_500, ...noWhole })).toBe(4_500);
    expect(rentOnStrategySwitch({ from: 'split', to: 'whole-home', currentRent: 3_993, ...noWhole })).toBe(3_993);
  });
});
