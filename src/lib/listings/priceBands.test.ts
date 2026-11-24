import { describe, expect, it } from "vitest";
import { PRICE_BANDS, groupSubTypes, priceBandBySlug, priceBandFilter, priceBandPath } from "./priceBands";

describe("priceBands", () => {
  it("resolves band slugs and builds the hub path", () => {
    const b = priceBandBySlug("1-million")!;
    expect(b.max).toBe(1_000_000);
    expect(priceBandPath("mississauga", b)).toBe("/property/on/mississauga/under/1-million");
    expect(priceBandBySlug("2-million")).toBeNull();
  });

  it("filters to homes at or under the band, without placeholder prices or parking", () => {
    const f = priceBandFilter(PRICE_BANDS[2]);
    expect(f).toContain("ListPrice:<=1000000");
    expect(f).toMatch(/ListPrice:>=\d{4,}/);
    expect(f).toContain("`Parking Space`");
    expect(f).toContain("`Vacant Land`");
  });

  it("groups sub-types into the four reported home groups", () => {
    expect(groupSubTypes({ Detached: 3, "Semi-Detached ": 2, "Att/Row/Townhouse": 4, "Condo Apartment": 10, "Condo Townhouse": 1, Duplex: 2 })).toEqual({
      detached: 3,
      semiTown: 6,
      condoApt: 10,
      condoTown: 1,
      other: 2,
    });
  });
});
