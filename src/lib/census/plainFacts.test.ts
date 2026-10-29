import { describe, expect, it } from "vitest";
import type { AreaFacts, AreaStats } from "./areaFacts";
import { areaRows, areaSummary, barWidth, fmtRowValue, peopleOfTen, rentCheckText, shareInWords } from "./plainFacts";

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

describe("areaRows", () => {
  it("leads each row with what it means, then here and the city", () => {
    const rows = areaRows(facts);
    expect(rows.map((r) => [r.key, r.label, r.here, r.city, r.unit, r.max])).toEqual([
      ["tenure", "Mostly owners", 14, 30, "%", 100],
      ["type", "Mostly houses", 4, 38, "%", 100],
      ["moves", "People stay", 29, 33, "%", 100],
      ["commute", "26 min commute", 26, 29, "min", 60],
    ]);
    expect(rows[0].text).toBe("14% of homes here are rented. In Mississauga, 30% are.");
    expect(rows[3].text).toBe("26 minutes is typical here. In Mississauga, 29 minutes.");
  });

  it("drops a missing figure and a missing city figure", () => {
    const rows = areaRows({ ...facts, here: stats({ rentPct: 65 }), city: stats({}) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Mostly renters", city: null, text: "65% of homes here are rented." });
  });
});

describe("bar helpers", () => {
  it("formats and scales the values", () => {
    expect(fmtRowValue(14.4, "%")).toBe("14%");
    expect(fmtRowValue(26, "min")).toBe("26 min");
    expect(barWidth(30, 60)).toBe(50);
    expect(barWidth(75, 60)).toBe(100);
    expect(peopleOfTen(47)).toBe(5);
    expect(peopleOfTen(3)).toBe(0);
    expect(peopleOfTen(100)).toBe(10);
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
