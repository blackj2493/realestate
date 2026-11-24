import { describe, expect, it } from "vitest";
import { cityMarketBySlug, getCityMarkets, toMarketRow } from "./cityMarkets";
import { buildOutlook } from "./marketOutlook";
import { EXTRA_STUDY_CITIES } from "./studyCities";
import { outlookCityBySlug } from "./outlookCities";

describe("city markets", () => {
  it("covers every extra study city and no board city", () => {
    const f = getCityMarkets();
    expect(f.cities.map((c) => c.city)).toEqual(EXTRA_STUDY_CITIES);
    for (const c of f.cities) expect(outlookCityBySlug(c.slug)).toBeNull();
  });

  it("feeds buildOutlook the same fields as a board row", () => {
    const f = getCityMarkets();
    for (const c of f.cities) {
      const row = toMarketRow(c);
      expect(row.cutShare).toBeCloseTo(c.cutCount / c.activeCount);
      expect(row.monthly.length).toBeGreaterThanOrEqual(12);
      const o = buildOutlook(c.city, row, f.generatedAt);
      expect(o?.facts.length).toBeGreaterThan(2);
    }
  });

  it("resolves slugs case-insensitively", () => {
    expect(cityMarketBySlug("London")?.city).toBe("London");
    expect(cityMarketBySlug("st-catharines")?.city).toBe("St. Catharines");
    expect(cityMarketBySlug("toronto")).toBeNull();
  });
});
