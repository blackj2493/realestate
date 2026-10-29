import { describe, expect, it } from "vitest";
import type { AreaFacts, AreaStats } from "./areaFacts";
import { areaSummary, plainLines, rentCheckText, shareInWords } from "./plainFacts";

const stats = (s: Partial<AreaStats>): AreaStats => ({
  households: 1000,
  rentPct: null,
  ownPct: null,
  moved5Pct: null,
  aptPct: null,
  bed3PlusPct: null,
  builtBefore1981Pct: null,
  transitWalkBikePct: null,
  drivePct: null,
  medianCommuteMin: null,
  tenantCostBurdenPct: null,
  medianIncome: null,
  ...s,
});

// The Mississauga listing from the owner's screenshot (2026-10-29).
const facts: AreaFacts = {
  v: 1,
  here: stats({ rentPct: 14, aptPct: 4, moved5Pct: 29, medianCommuteMin: 26 }),
  city: stats({ rentPct: 30, aptPct: 38, moved5Pct: 33, medianCommuteMin: 29 }),
  cityName: "Mississauga",
  das: 5,
  pop: 2400,
  incomeGroups: [],
};

describe("plainLines", () => {
  it("leads each figure with what it means", () => {
    expect(plainLines(facts)).toEqual([
      { label: "Mostly owners", text: "14% of homes here are rented. In Mississauga, 30% are." },
      { label: "Mostly houses", text: "4% of homes here are apartments. In Mississauga, 38% are." },
      { label: "People stay", text: "29% moved in during the last 5 years. In Mississauga, 33% did." },
      { label: "Commute", text: "26 minutes is typical here. In Mississauga, 29 minutes." },
    ]);
  });

  it("drops a missing figure and a missing city figure", () => {
    const lines = plainLines({ ...facts, here: stats({ rentPct: 65 }), city: stats({}) });
    expect(lines).toEqual([{ label: "Mostly renters", text: "65% of homes here are rented." }]);
  });
});

describe("areaSummary", () => {
  it("gives the tenure verdict and the commute", () => {
    expect(areaSummary(facts)).toBe("Mostly owners · 26 min commute");
    expect(areaSummary({ ...facts, here: stats({}) })).toBeNull();
  });
});

describe("rent check text", () => {
  it("states the share in words", () => {
    expect(shareInWords(47, false)).toBe("About half");
    expect(shareInWords(28, false)).toBe("About 3 in 10");
    expect(shareInWords(3, false)).toBe("Fewer than 1 in 10");
    expect(shareInWords(12, true)).toBe("At most 1 in 10");
    expect(rentCheckText(3350, { incomeNeeded: 134000, sharePct: 47, atTop: false })).toEqual([
      "A rent of $3,350/mo needs a household income of about $134,000.",
      "About half of the households here earn that much.",
    ]);
    expect(rentCheckText(2000, { incomeNeeded: 80000, sharePct: 61, atTop: false })[1]).toBe(
      "About 6 in 10 households here earn that much.",
    );
  });
});
