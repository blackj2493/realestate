import { describe, it, expect } from "vitest";
import { monthlyCashflow, breakEvenCapRate } from "./liveCashflow";
import type { SharedDealInputs } from "@/lib/finance/dealInputs";

const today: SharedDealInputs = { downPaymentPct: 20, interestRatePct: 5.5, amortYears: 25 };

describe("monthlyCashflow", () => {
  it("returns null when there is no cap rate", () => {
    // "No comp" must not sort between the losers and the winners — it is not zero.
    expect(monthlyCashflow({ listPrice: 900_000, capRatePct: null }, today)).toBeNull();
    expect(monthlyCashflow({ listPrice: 900_000, capRatePct: 0 }, today)).toBeNull();
  });

  it("returns null for a cap rate outside the sanity band", () => {
    // Same guard the rest of the page uses; a fabricated negative is not a loss.
    expect(monthlyCashflow({ listPrice: 900_000, capRatePct: -4 }, today)).toBeNull();
    expect(monthlyCashflow({ listPrice: 900_000, capRatePct: 40 }, today)).toBeNull();
  });

  it("returns null without a usable price", () => {
    expect(monthlyCashflow({ listPrice: 0, capRatePct: 5 }, today)).toBeNull();
    expect(monthlyCashflow({ listPrice: null, capRatePct: 5 }, today)).toBeNull();
  });

  it("is negative on a typical GTA cap rate", () => {
    // 2.12% is the measured GTA median. It must not come out positive.
    expect(monthlyCashflow({ listPrice: 1_000_000, capRatePct: 2.12 }, today)!).toBeLessThan(0);
  });

  it("crosses zero exactly at the break-even cap rate", () => {
    const be = breakEvenCapRate(today);
    expect(monthlyCashflow({ listPrice: 1_000_000, capRatePct: be + 0.05 }, today)!).toBeGreaterThan(0);
    expect(monthlyCashflow({ listPrice: 1_000_000, capRatePct: be - 0.05 }, today)!).toBeLessThan(0);
  });

  it("improves as the down payment rises", () => {
    const at20 = monthlyCashflow({ listPrice: 900_000, capRatePct: 4 }, today)!;
    const at50 = monthlyCashflow({ listPrice: 900_000, capRatePct: 4 }, { ...today, downPaymentPct: 50 })!;
    expect(at50).toBeGreaterThan(at20);
  });

  it("worsens as the rate rises", () => {
    const at5 = monthlyCashflow({ listPrice: 900_000, capRatePct: 4 }, { ...today, interestRatePct: 5 })!;
    const at7 = monthlyCashflow({ listPrice: 900_000, capRatePct: 4 }, { ...today, interestRatePct: 7 })!;
    expect(at7).toBeLessThan(at5);
  });

  it("has no mortgage at all when the buyer pays cash", () => {
    // 100% down: cashflow is just NOI/12. 6% of $1M is $60k/yr, $5,000/mo.
    expect(monthlyCashflow({ listPrice: 1_000_000, capRatePct: 6 }, { ...today, downPaymentPct: 100 })).toBe(5_000);
  });
});

describe("breakEvenCapRate", () => {
  it("is about 5.85% at 20% down / 5.5% / 25yr", () => {
    expect(breakEvenCapRate(today)).toBeCloseTo(5.85, 1);
  });

  it("is about 4.59% at the ETL's stored assumption (20% / 4.04% / 30yr)", () => {
    // This gap is why the stored net_monthly_cashflow and the sandbox disagreed about
    // the sign on the same listing.
    expect(breakEvenCapRate({ downPaymentPct: 20, interestRatePct: 4.04, amortYears: 30 }))
      .toBeCloseTo(4.59, 1);
  });

  it("does not depend on price — which is what makes it a single filter clause", () => {
    const be = breakEvenCapRate(today);
    for (const listPrice of [300_000, 1_000_000, 4_000_000]) {
      expect(Math.abs(monthlyCashflow({ listPrice, capRatePct: be }, today)!)).toBeLessThan(2);
    }
  });

  it("falls as the down payment rises, and is zero on an all-cash purchase", () => {
    expect(breakEvenCapRate({ ...today, downPaymentPct: 50 })).toBeLessThan(breakEvenCapRate(today));
    expect(breakEvenCapRate({ ...today, downPaymentPct: 100 })).toBe(0);
  });
});

// ── The filter and the column must never disagree ────────────────────────────────
// The "Cashflow positive only" toggle filters server-side on cap_rate_est >= the
// break-even, while the ledger cell computes dollars client-side. If those two ever
// drift apart, the list shows a listing labelled −$300/mo inside a "positive only"
// result — the same class of contradiction as a cap rate that disagreed with the
// calculator beside it.
describe("filter and column agree", () => {
  const inputs = [
    { downPaymentPct: 20, interestRatePct: 5.5, amortYears: 25 },
    { downPaymentPct: 35, interestRatePct: 4.25, amortYears: 30 },
    { downPaymentPct: 5, interestRatePct: 7, amortYears: 25 },
  ];

  it("every listing passing the filter shows non-negative dollars", () => {
    for (const f of inputs) {
      const threshold = breakEvenCapRate(f);
      for (const capRatePct of [threshold, threshold + 0.5, threshold + 3, 14.9]) {
        for (const listPrice of [250_000, 900_000, 3_500_000]) {
          const cash = monthlyCashflow({ listPrice, capRatePct }, f);
          expect(cash, `cap ${capRatePct} @ ${listPrice}`).not.toBeNull();
          // -1 tolerance: the cell rounds to whole dollars, so a listing sitting
          // exactly on the threshold can round to -0.
          expect(cash!, `cap ${capRatePct} @ ${listPrice}`).toBeGreaterThanOrEqual(-1);
        }
      }
    }
  });

  it("every listing failing the filter shows negative dollars", () => {
    for (const f of inputs) {
      const threshold = breakEvenCapRate(f);
      for (const capRatePct of [threshold - 0.5, threshold - 2, 1.1]) {
        if (capRatePct < 1) continue; // below CAP_RATE_BAND — reads as "no estimate"
        for (const listPrice of [250_000, 900_000, 3_500_000]) {
          expect(monthlyCashflow({ listPrice, capRatePct }, f)!).toBeLessThan(0);
        }
      }
    }
  });
});
