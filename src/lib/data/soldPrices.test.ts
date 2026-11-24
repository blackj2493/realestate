import { describe, expect, it } from "vitest";
import { buildSoldFacts, getSoldData, rankedSoldCities, type SoldCity, type SoldPricesFile } from "./soldPrices";

const st = (medianPrice: number, sales = 500) => ({ sales, medianPrice, saleToAsk: 97, overAskShare: 15, medianDom: 25 });
const city: SoldCity = {
  city: "Testville",
  slug: "testville",
  all: st(800_000, 5000),
  byType: { detached: st(1_200_000), semiTown: st(900_000), condoApt: st(550_000), condoTown: null },
  detachedByBeds: [
    { beds: "3", sales: 200, medianPrice: 1_100_000 },
    { beds: "4", sales: 250, medianPrice: 1_500_000 },
  ],
  communities: ["A", "B", "C", "D"].map((n, i) => ({
    name: n,
    sales: 100,
    medianPrice: 900_000,
    byType: { detached: 2_000_000 - i * 300_000, semiTown: null, condoApt: null, condoTown: null },
  })),
};
const file: SoldPricesFile = { generatedAt: "2026-11-25T12:00:00Z", from: "2025-11-01", to: "2026-11-01", cities: [city] };

describe("soldPrices", () => {
  it("states the median, sale-to-asking, types, bedrooms and the community range", () => {
    const f = buildSoldFacts(city, file, 2026)!;
    expect(f.title).toBe("Testville Sold Prices 2026: Median Sold Price by Neighbourhood and Home Type");
    expect(f.facts[0].text).toContain("median $800,000 (5,000 sales, Nov 2025 to Oct 2026), at a median 97.0% of the asking price; 15% sold over asking");
    expect(f.facts.find((x) => x.id === "types")!.text).toContain("detached houses $1,200,000");
    expect(f.facts.find((x) => x.id === "beds")!.text).toContain("4 bedrooms $1,500,000");
    expect(f.facts.find((x) => x.id === "range")!.text).toContain("$2,000,000 (A) to $1,100,000 (D)");
  });

  it("points the reader to sign in for single sales (VOW), never shows one", () => {
    const f = buildSoldFacts(city, file, 2026)!;
    expect(f.faqs.at(-1)!.a).toContain("shown only to signed-in users");
  });

  it("the committed data file: every city has facts, ranked by median", () => {
    const data = getSoldData();
    const ranked = rankedSoldCities(data);
    expect(ranked.length).toBeGreaterThanOrEqual(10);
    for (const c of data.cities) expect(buildSoldFacts(c, data, 2026)).not.toBeNull();
  });
});
