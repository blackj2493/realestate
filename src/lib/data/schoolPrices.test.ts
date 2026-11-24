import { describe, expect, it } from "vitest";
import { bandOf, buildSchoolFacts, getSchoolData, premiumKind, rankedSchoolCities, type SchoolCity, type SchoolPricesFile } from "./schoolPrices";
import { asPct, fitWithinCell } from "./withinCellModel";

const g = (pct: number, significant = true) => ({ pct, lo: pct - 1, hi: pct + 1, significant });
const city = (over: Partial<SchoolCity> = {}): SchoolCity => ({
  city: "Testville",
  slug: "testville",
  board: "Testville District School Board",
  sales: 5000,
  medianPrice: 1_200_000,
  perPoint: g(2),
  bands: { lt6: { ...g(-3), sales: 300 }, "6to7": { ...g(-2), sales: 400 }, "7to8": null, "8to9": { ...g(1.9), sales: 900 }, "9plus": { ...g(7.3), sales: 600 } },
  catchments: Array.from({ length: 8 }, (_, i) => ({ school: `School ${i}`, score: 9 - i * 0.5, sales: 40, medianPrice: 1_000_000, vsSimilar: 10 - i * 3 })),
  ...over,
});
const file: SchoolPricesFile = { generatedAt: "2026-11-25T12:00:00Z", from: "2024-11-01", to: "2026-11-01", cities: [city()] };

describe("withinCellModel", () => {
  it("recovers a planted per-point premium inside cells", () => {
    let a = 3;
    const r = () => (a = (a * 1103515245 + 12345) % 2147483648) / 2147483648;
    const rows = [];
    for (let c = 0; c < 200; c++) {
      const base = 13.8 + r();
      for (let i = 0; i < 8; i++) {
        const score = 5 + r() * 5;
        rows.push({ cell: `c${c}`, y: base + score * Math.log(1.02) + (r() - 0.5) * 0.05, x: [score] });
      }
    }
    const fit = fitWithinCell(rows, ["score"])!;
    expect(asPct(fit.coef.score!.b)).toBeCloseTo(2, 0);
    expect(fit.coef.score!.significant).toBe(true);
  });
});

describe("schoolPrices", () => {
  it("bands scores with 7 to 8 as the comparison", () => {
    expect([5.9, 6, 7.5, 8.2, 9].map(bandOf)).toEqual(["lt6", "6to7", "7to8", "8to9", "9plus"]);
  });

  it("states a strong premium with the 9+ dollar figure", () => {
    const f = buildSchoolFacts(city(), file, 2026)!;
    expect(f.facts[0].text).toContain("each extra point of the elementary school's score added +2.0%");
    expect(f.facts.find((x) => x.id === "top")!.text).toContain("about $88,000");
    expect(f.facts.find((x) => x.id === "range")!.text).toContain("This includes the neighbourhood");
  });

  it("says 'no measurable difference' when the slope is not significant, and qualifies a reverse slope", () => {
    expect(buildSchoolFacts(city({ perPoint: g(0.4, false) }), file, 2026)!.facts[0].text).toContain("no measurable difference");
    expect(premiumKind(city({ perPoint: g(-1.6) }))).toBe("reverse");
    expect(buildSchoolFacts(city({ perPoint: g(-1.6) }), file, 2026)!.facts[0].text).toContain("not a school effect alone");
  });

  it("the committed data file: every city has facts; Toronto has a premium", () => {
    const data = getSchoolData();
    for (const c of rankedSchoolCities(data)) expect(buildSchoolFacts(c, data, 2026)).not.toBeNull();
    expect(data.cities.find((c) => c.slug === "toronto")?.perPoint?.significant).toBe(true);
  });
});
