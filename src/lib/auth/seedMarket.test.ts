import { describe, it, expect } from "vitest";
import { marketSourceFromNext } from "./seedMarket";
import { regionForCity, CITY_GROUPS, areaFilter } from "@/lib/dashboard/area";

describe("marketSourceFromNext", () => {
  it("reads the listing key off a property URL", () => {
    expect(marketSourceFromNext("/properties/X12639568")).toEqual({
      kind: "listing",
      listingKey: "X12639568",
    });
  });

  it("ignores query strings and hashes", () => {
    expect(marketSourceFromNext("/properties/X12639568?lens=cashflow")).toEqual({
      kind: "listing",
      listingKey: "X12639568",
    });
    expect(marketSourceFromNext("/properties/X12639568#rooms")).toEqual({
      kind: "listing",
      listingKey: "X12639568",
    });
  });

  it("reads the listing key off an address URL", () => {
    expect(marketSourceFromNext("/address/on/vaughan/128-maplecrest-ave-X12639568")).toEqual({
      kind: "listing",
      listingKey: "X12639568",
    });
  });

  it("falls back to the city segment on a key-less address profile", () => {
    expect(marketSourceFromNext("/address/on/richmond-hill/128-maplecrest-ave")).toEqual({
      kind: "city",
      city: "Richmond Hill",
    });
  });

  it("declines the compare page — a shortlist names no single market", () => {
    expect(marketSourceFromNext("/properties/compare?ids=A,B")).toBeNull();
  });

  it("declines the terminal, the dashboard and anything place-less", () => {
    expect(marketSourceFromNext("/properties")).toBeNull();
    expect(marketSourceFromNext("/dashboard")).toBeNull();
    expect(marketSourceFromNext("/analytics")).toBeNull();
    expect(marketSourceFromNext(null)).toBeNull();
    expect(marketSourceFromNext("https://evil.example/properties/X12639568")).toBeNull();
  });
});

describe("regionForCity", () => {
  it("rolls a Toronto district up to its part, not the whole city", () => {
    // Saving "Toronto C12" verbatim would scope the whole dashboard to one district, and
    // the whole of Toronto is too big to follow (cityParts.ts).
    expect(regionForCity("Toronto C12")).toBe("North York");
    expect(regionForCity("Toronto C11")).toBe("East End and East York");
  });

  it("keeps the bare Toronto value as the city", () => {
    expect(regionForCity("Toronto")).toBe("Toronto");
  });

  it("rolls an Ottawa OREB area up to its part, not the whole city", () => {
    // A membership lookup, not a suffix strip: no string rule turns "Barrhaven" into
    // anything. The whole of Ottawa is too big to follow (cityParts.ts).
    expect(regionForCity("Barrhaven")).toBe("Barrhaven and Manotick");
  });

  it("keeps the bare Ottawa value as the city", () => {
    expect(regionForCity("Ottawa")).toBe("Ottawa");
  });

  it("rolls a London directional up to the city", () => {
    expect(regionForCity("London South")).toBe("London");
  });

  it("passes an ungrouped municipality through unchanged", () => {
    expect(regionForCity("Mississauga")).toBe("Mississauga");
    expect(regionForCity("Burlington")).toBe("Burlington");
  });

  it("is case-insensitive and trims", () => {
    expect(regionForCity("  toronto c12 ")).toBe("North York");
    expect(regionForCity("  BARRHAVEN ")).toBe("Barrhaven and Manotick");
  });

  it("returns null for nothing usable", () => {
    expect(regionForCity(null)).toBeNull();
    expect(regionForCity("")).toBeNull();
    expect(regionForCity("   ")).toBeNull();
  });

  it("returns a value the dashboard can actually filter on", () => {
    // The point of seeding is a dashboard with content. A grouped parent must expand to a
    // City:=[…] IN clause, not an exact match that hits nothing (see CITY_GROUPS).
    const region = regionForCity("Toronto C12");
    expect(region).not.toBeNull();
    expect(CITY_GROUPS[region as string]).toBeDefined();
    expect(areaFilter({ kind: "region", name: region as string })).toContain("City:=[");
  });
});
