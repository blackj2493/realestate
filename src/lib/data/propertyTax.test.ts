import { describe, expect, it } from "vitest";
import { buildTaxFacts, getTaxData, rankedTaxCities, taxAreaBySlug, taxHomeTypeOf, type PropertyTaxFile, type TaxArea, type TaxStats } from "./propertyTax";

const s = (medianTax: number, taxPer100k: number, sales = 100): TaxStats => ({ sales, medianTax, lowTax: medianTax - 1000, highTax: medianTax + 1000, medianPrice: 900000, taxPer100k });
const area = (city: string, slug: string, tax: number, per100k: number): TaxArea => ({
  city,
  slug,
  taxYear: 2025,
  all: s(tax, per100k),
  byType: { detached: s(tax + 1500, per100k), semi: null, town: null, condoTown: null, condoApt: s(tax - 1500, per100k) },
  communities: [],
});
const file: PropertyTaxFile = {
  generatedAt: "2026-11-26T11:00:00.000Z",
  from: "2025-11-01",
  to: "2026-11-01",
  cities: [area("Toronto", "toronto", 4170, 501), area("Brampton", "brampton", 5790, 702), area("London", "london", 4060, 737), area("Vaughan", "vaughan", 5090, 469), area("Belleville", "belleville", 4100, 852)],
};

describe("propertyTax", () => {
  it("maps MLS® sub types, including TRREB's trailing space", () => {
    expect(taxHomeTypeOf("Semi-Detached ")).toBe("semi");
    expect(taxHomeTypeOf("Condo Apartment")).toBe("condoApt");
    expect(taxHomeTypeOf("Vacant Land")).toBeNull();
  });

  it("ranks cities by tax per $100,000, lowest first", () => {
    expect(rankedTaxCities(file).map((c) => c.slug)).toEqual(["vaughan", "toronto", "brampton", "london", "belleville"]);
  });

  it("answers the searched questions with the yearly and monthly bill", () => {
    const f = buildTaxFacts(file.cities[0], file, 2026)!;
    expect(f.title).toBe("How Much Is Property Tax in Toronto? (2026) By Home Type and Community");
    expect(f.facts[0].text).toBe(
      "Homes that sold in Toronto from Nov 2025 to Oct 2026 carried a median property tax of $4,170 a year (about $348 a month); the middle half paid $3,170 to $5,170.",
    );
    expect(f.facts.find((x) => x.id === "rate")!.text).toContain("the 2nd lowest of 5 Ontario cities (from $469 in Vaughan to $852 in Belleville)");
    expect(f.faqs.map((q) => q.q)).toContain("How much is property tax in Toronto per month?");
    expect(f.faqs[1].a).toContain("detached house $473, condo apartment $223 a month");
  });

  it("ships a data file whose cities all build", () => {
    const data = getTaxData();
    expect(data.cities.length).toBeGreaterThanOrEqual(10);
    expect(taxAreaBySlug("toronto")).not.toBeNull();
    for (const c of data.cities) expect(buildTaxFacts(c, data, 2026)).not.toBeNull();
  });
});
