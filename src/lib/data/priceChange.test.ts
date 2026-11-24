import { describe, expect, it } from "vitest";
import { buildPriceChangeFacts, getPriceChangeData, rankedAreas, trendText, type PriceChangeArea, type PriceChangeFile } from "./priceChange";

const ch = (pct: number, significant = true) => ({ pct, lo: pct - 1, hi: pct + 1, significant, cells: 200, sales: 2000, shareDown: 0.8 });

const area: PriceChangeArea = {
  city: "Testville",
  slug: "testville",
  sales: 5000,
  all: ch(-7.5),
  byType: { detached: ch(-5), semiTown: ch(-6), condoApt: ch(-9), condoTown: null },
  medianPrice: { detached: 1_300_000, semiTown: 1_000_000, condoApt: 600_000, condoTown: null },
  quarters: [
    { label: "Q3 2025", all: ch(-8), house: ch(-6), condo: ch(-9) },
    { label: "Q4 2025", all: ch(-9), house: ch(-7), condo: ch(-10) },
    { label: "Q1 2026", all: ch(-9.5), house: ch(-7), condo: ch(-11) },
    { label: "Q2 2026", all: ch(-8), house: ch(-6), condo: ch(-9) },
    { label: "Q3 2026", all: ch(-6.5), house: ch(-5), condo: ch(-7.5) },
  ],
};
const file: PriceChangeFile = { generatedAt: "2026-11-25T12:00:00Z", earlierFrom: "2024-11-01", laterFrom: "2025-11-01", laterTo: "2026-11-01", ontario: area, cities: [area] };

describe("priceChange", () => {
  it("says the drop got smaller when the latest quarter is well below the deepest", () => {
    const t = trendText(area.quarters.map((q) => ({ label: q.label, c: q.condo })), "condos")!;
    expect(t).toContain("−11.0% in Q1 2026 and −7.5% in Q3 2026");
    expect(t).toContain("got smaller");
  });

  it("says the drop got larger when it deepens to the latest quarter", () => {
    const s = [ch(-3), ch(-4), ch(-5.5)].map((c, i) => ({ label: `Q${i + 1}`, c }));
    expect(trendText(s, "houses")).toContain("got larger");
  });

  it("builds facts, a non-forecast 2027 answer and the condo FAQ", () => {
    const f = buildPriceChangeFacts(area, file, 2026)!;
    expect(f.window).toBe("Nov 2025 to Oct 2026");
    expect(f.facts[0].text).toContain("7.5% lower than");
    expect(f.facts.find((x) => x.id === "gap")!.text).toContain("Condo apartments fell more than detached houses");
    expect(f.outlook).toContain("does not forecast");
    expect(f.faqs.map((q) => q.q)).toContain("Will house prices drop in Testville in 2027?");
  });

  it("calls a change inside its range 'about the same'", () => {
    const f = buildPriceChangeFacts({ ...area, all: ch(-0.4, false) }, file, 2026)!;
    expect(f.facts[0].text).toContain("about the same as");
  });

  it("the committed data file has every city ranked, each with facts", () => {
    const data = getPriceChangeData();
    const ranked = rankedAreas(data);
    expect(ranked.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].all!.pct).toBeLessThanOrEqual(ranked[i].all!.pct);
    for (const a of ranked) expect(buildPriceChangeFacts(a, data, 2026)).not.toBeNull();
  });
});
