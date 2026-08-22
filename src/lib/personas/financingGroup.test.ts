import { describe, it, expect } from "vitest";
import { INVESTOR_CONTROLS, isFinancingControl, FINANCING_CONTROL_KEYS } from "./personaConfig";
import { breakEvenCapRate } from "@/lib/metrics/liveCashflow";

describe("financing control group", () => {
  it("claims exactly the three controls that describe the reader, not the property", () => {
    const grouped = INVESTOR_CONTROLS.filter(isFinancingControl).map((c) =>
      c.kind === "range" ? c.minKey : c.key
    );
    expect(grouped.sort()).toEqual([...FINANCING_CONTROL_KEYS].sort());
  });

  it("every grouped control resolves to a real control — the list cannot rot", () => {
    // A typo'd or renamed key would silently leave that chip in the loose row.
    for (const key of FINANCING_CONTROL_KEYS) {
      expect(
        INVESTOR_CONTROLS.some((c) => c.kind !== "range" && c.key === key),
        `${key} must exist in INVESTOR_CONTROLS`
      ).toBe(true);
    }
  });

  it("the two sliders really do filter nothing — that is why they need explaining", () => {
    // If either ever gains a clause, the group's copy ("assumptions, not filters") is a lie
    // and this test is the thing that says so.
    for (const key of ["downPaymentPct", "interestRatePct"]) {
      const c = INVESTOR_CONTROLS.find((x) => x.kind !== "range" && x.key === key)!;
      expect(
        c.buildClause({ downPaymentPct: 20, interestRatePct: 5.5, amortYears: 25 } as never),
        `${key} must not build a clause`
      ).toBeNull();
    }
  });

  it("the toggle DOES filter, and its threshold moves with the sliders", () => {
    const toggle = INVESTOR_CONTROLS.find(
      (c) => c.kind !== "range" && c.key === "cashflowPositiveOnly"
    )!;
    const at55 = toggle.buildClause({
      cashflowPositiveOnly: true, downPaymentPct: 20, interestRatePct: 5.5, amortYears: 25,
    } as never);
    const at404 = toggle.buildClause({
      cashflowPositiveOnly: true, downPaymentPct: 20, interestRatePct: 4.04, amortYears: 30,
    } as never);
    expect(at55).not.toBeNull();
    expect(at55).not.toBe(at404);
    expect(
      toggle.buildClause({ cashflowPositiveOnly: false, downPaymentPct: 20, interestRatePct: 5.5, amortYears: 25 } as never)
    ).toBeNull();
  });

  it("the number the group displays matches the number the filter uses", () => {
    // The box prints breakEvenCapRate(); the toggle filters on it. If they ever came from
    // different code paths the panel would explain a threshold it does not apply.
    const inputs = { downPaymentPct: 20, interestRatePct: 5.5, amortYears: 25 };
    const shown = breakEvenCapRate(inputs as never);
    const toggle = INVESTOR_CONTROLS.find(
      (c) => c.kind !== "range" && c.key === "cashflowPositiveOnly"
    )!;
    expect(toggle.buildClause({ ...inputs, cashflowPositiveOnly: true } as never)).toContain(
      shown.toFixed(2)
    );
    // Sanity on the documented figure: ~5.85% at 20% down / 5.5% / 25yr.
    expect(shown).toBeGreaterThan(5.7);
    expect(shown).toBeLessThan(6.0);
  });
});
