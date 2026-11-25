import { describe, expect, it } from "vitest";
import { cityMarketBySlug, coveredMarketCities, coveredMarketRows, getCityMarkets, toMarketRow } from "./cityMarkets";
import { buildOutlook } from "./marketOutlook";
import { buildSellingTime } from "./sellingTime";
import { buildBuyVerdict } from "./goodTimeToBuy";
import { buildRentVsBuy } from "./rentVsBuy";
import { MIN_RENT_SAMPLE } from "./cityMarketsModel";
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

  it("feeds the days-on-market and good-time-to-buy pages", () => {
    const f = getCityMarkets();
    const rows = coveredMarketRows([]); // no board rows in a unit test: the 11 extra cities
    for (const c of f.cities) {
      const row = toMarketRow(c);
      const st = buildSellingTime(c.city, row, rows, f.generatedAt);
      expect(st?.stats.sold?.median).toBe(c.soldMedianDom);
      expect(st?.stats.rank?.of).toBe(f.cities.length);
      expect(st?.stats.stale90Pct).not.toBeNull();
      const v = buildBuyVerdict(c.city, row, rows, null);
      expect(v?.signals.map((s) => s.id)).toEqual(expect.arrayContaining(["temperature", "saleToList", "cuts", "stale"]));
    }
  });

  it("feeds the rent-vs-buy page, without thin rent rows", () => {
    const f = getCityMarkets();
    const rows = coveredMarketRows([]);
    for (const c of f.cities) {
      const row = toMarketRow(c);
      const thin = c.rentalRows.filter((r) => r.rentSample < MIN_RENT_SAMPLE).map((r) => r.beds);
      for (const b of thin) expect(row.rentalRows.find((r) => r.beds === b)).toBeUndefined();
      const v = buildRentVsBuy(c.city, row, rows, f.generatedAt, 2026);
      expect(v?.lead.beds).toBe(2);
      expect(v?.rank?.of).toBe(f.cities.length);
    }
  });

  it("lists every covered city once", () => {
    const slugs = coveredMarketCities().map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain("toronto");
    expect(slugs).toContain("london");
  });

  it("resolves slugs case-insensitively", () => {
    expect(cityMarketBySlug("London")?.city).toBe("London");
    expect(cityMarketBySlug("st-catharines")?.city).toBe("St. Catharines");
    expect(cityMarketBySlug("toronto")).toBeNull();
  });
});
