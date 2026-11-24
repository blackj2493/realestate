import { describe, expect, it } from "vitest";
import { buildCondoFacts, getCondoData, rankedCondoCities, unitTypeOf, type CondoArea, type CondoPricesFile, type CondoStats } from "./condoPrices";

const st = (over: Partial<CondoStats> = {}): CondoStats => ({
  sales: 500, medianPrice: 550_000, medianSqft: 700, pricePsf: 780, medianFee: 700, feePsf: 0.95, feeSample: 480,
  saleToAsk: 96.7, overAskShare: 12, medianDom: 28, ...over,
});
const area: CondoArea = {
  city: "Testville",
  slug: "testville",
  all: st(),
  byUnit: { studio: null, one: st({ medianPrice: 445_000 }), oneDen: st({ medianPrice: 520_000 }), two: st({ medianPrice: 635_000 }), twoDen: null, three: null },
  communities: [
    { name: "Alpha", ...st({ pricePsf: 1000 }) },
    { name: "Beta", ...st({ pricePsf: 800 }) },
    { name: "Gamma", ...st({ pricePsf: 700 }) },
    { name: "Delta", ...st({ pricePsf: 600 }) },
  ],
};
const file: CondoPricesFile = { generatedAt: "2026-11-25T12:00:00Z", from: "2025-11-01", to: "2026-11-01", cities: [area] };

describe("condoPrices", () => {
  it("maps bedrooms to unit types, with the den counted in the total only", () => {
    expect(unitTypeOf(0, 0)).toBe("studio");
    expect(unitTypeOf(1, 1)).toBe("one");
    expect(unitTypeOf(1, 2)).toBe("oneDen");
    expect(unitTypeOf(2, 2)).toBe("two");
    expect(unitTypeOf(2, 3)).toBe("twoDen");
    expect(unitTypeOf(3, 3)).toBe("three");
    expect(unitTypeOf(0, 2)).toBeNull();
  });

  it("states price, per sq ft, units, fee, market and the community range", () => {
    const f = buildCondoFacts(area, file, 2026)!;
    expect(f.title).toBe("Testville Condo Prices 2026: Median Price, Price per Sq Ft and Condo Fees");
    expect(f.facts[0].text).toContain("median $550,000 (500 sales, Nov 2025 to Oct 2026), about $780 a square foot");
    expect(f.facts.find((x) => x.id === "units")!.text).toContain("1 bedroom + den $520,000");
    expect(f.facts.find((x) => x.id === "fee")!.text).toContain("about $0.95 a square foot a month");
    expect(f.facts.find((x) => x.id === "range")!.text).toContain("$1,000 a square foot (Alpha) to $600 (Delta)");
    expect(f.faqs.map((q) => q.q)).toContain("What are average condo fees in Testville per square foot?");
  });

  it("the committed data file: every city has facts, ranked by price per sq ft", () => {
    const data = getCondoData();
    const ranked = rankedCondoCities(data);
    expect(ranked.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].all.pricePsf!).toBeGreaterThanOrEqual(ranked[i].all.pricePsf!);
    for (const c of data.cities) expect(buildCondoFacts(c, data, 2026)).not.toBeNull();
  });
});
