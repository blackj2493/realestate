import { describe, it, expect } from "vitest";
import { strategyOptionsFor } from "./StrategyPicker";

const money = (n: number) => `$${n.toLocaleString()}`;
const band = { low: 90_000, high: 225_000 };
const ids = (o: ReturnType<typeof strategyOptionsFor>) => o.map((x) => x.id);

describe("strategyOptionsFor", () => {
  it("offers Split first when the home HAS a suite", () => {
    const o = strategyOptionsFor({ suiteMonthlyRent: 1_700, formatMoney: money });
    expect(ids(o)).toEqual(["split", "whole-home"]);
  });

  it("prefers the observed suite over the conversion scenario", () => {
    // A home that already earns suite income should not be offered a renovation to
    // build one it has.
    const o = strategyOptionsFor({
      suiteMonthlyRent: 1_700, areaSuiteMonthlyRent: 1_480, suiteConversion: band, formatMoney: money,
    });
    expect(ids(o)).not.toContain("add-suite");
  });

  it("offers Add a suite when a cost AND an area rent are both known", () => {
    const o = strategyOptionsFor({ areaSuiteMonthlyRent: 1_480, suiteConversion: band, formatMoney: money });
    expect(ids(o)).toEqual(["whole-home", "add-suite"]);
    expect(o[1].hint).toContain("$90,000");
    expect(o[1].hint).toContain("$225,000");
  });

  /**
   * The rule that matters. An anon reader's rent figures are VOW-gated, so this
   * arrives null while the build cost — derived from the basement description — does
   * not. Offering the scenario then shows a $90k-$225k bill against no income at all.
   */
  it("hides Add a suite when the rent is unknown but the cost is not", () => {
    expect(strategyOptionsFor({ suiteConversion: band, formatMoney: money })).toEqual([]);
    expect(strategyOptionsFor({ areaSuiteMonthlyRent: null, suiteConversion: band, formatMoney: money })).toEqual([]);
  });

  it("hides Add a suite when the home cannot take one", () => {
    // No basement, a condo, or a home that already has a suite — suiteConversion is
    // null for all three, and a rent figure alone is not an invitation to renovate.
    expect(strategyOptionsFor({ areaSuiteMonthlyRent: 1_480, suiteConversion: null, formatMoney: money })).toEqual([]);
  });

  it("offers nothing when nothing is known", () => {
    expect(strategyOptionsFor({ formatMoney: money })).toEqual([]);
  });

  it("treats a zero rent as no rent", () => {
    expect(strategyOptionsFor({ suiteMonthlyRent: 0, suiteConversion: band, areaSuiteMonthlyRent: 0, formatMoney: money })).toEqual([]);
  });

  it("never offers a single position — a picker of one is not a choice", () => {
    for (const input of [
      { suiteMonthlyRent: 1_700 },
      { areaSuiteMonthlyRent: 1_480, suiteConversion: band },
      {},
    ]) {
      const o = strategyOptionsFor({ ...input, formatMoney: money });
      expect(o.length === 0 || o.length === 2).toBe(true);
    }
  });
});
