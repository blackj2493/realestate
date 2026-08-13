import { describe, it, expect } from "vitest";
import { scopeAreaLabel, MAX_NAMED_AREAS, type AreaFields } from "./scopeAreaLabel";

/** n rows in one neighbourhood of one city. */
function rows(n: number, CityRegion: string, City = "Toronto C15"): AreaFields[] {
  return Array.from({ length: n }, () => ({ City, CityRegion }));
}

describe("scopeAreaLabel", () => {
  it("returns null for an empty result set", () => {
    expect(scopeAreaLabel([])).toBeNull();
  });

  it("names the neighbourhood a viewport sits in", () => {
    expect(scopeAreaLabel(rows(10, "Henry Farm"))).toBe("Henry Farm");
  });

  it("counts the other neighbourhoods alongside the largest", () => {
    const listings = [...rows(8, "Henry Farm"), ...rows(1, "Pleasant View"), ...rows(1, "L'Amoreaux")];
    expect(scopeAreaLabel(listings)).toBe("Henry Farm +2");
  });

  it("still names a neighbourhood when none dominates", () => {
    // The shape a real ~3km Toronto viewport takes (measured: 9 neighbourhoods, top at
    // 30%). A dominance test would fall through to the city here; the neighbourhood is
    // the more useful answer, with +N carrying the breadth.
    const listings = [
      ...rows(30, "Henry Farm"),
      ...rows(26, "Don Valley Village"),
      ...rows(20, "Pleasant View"),
      ...rows(13, "L'Amoreaux"),
      ...rows(8, "Hillcrest Village"),
      ...rows(2, "Bayview Village"),
    ];
    expect(scopeAreaLabel(listings)).toBe("Henry Farm +5");
  });

  it("steps up to the city once the viewport is too fragmented to name one", () => {
    // One row in each of MAX_NAMED_AREAS + 1 neighbourhoods, all in Markham.
    const listings = Array.from({ length: MAX_NAMED_AREAS + 1 }, (_, i) => ({
      City: "Markham",
      CityRegion: `Hood ${i}`,
    }));
    expect(scopeAreaLabel(listings)).toBe("Markham");
  });

  it("counts other cities at the city level", () => {
    const listings = [
      ...Array.from({ length: MAX_NAMED_AREAS + 1 }, (_, i) => ({ City: "Markham", CityRegion: `Hood ${i}` })),
      { City: "Vaughan", CityRegion: "Beverley Glen" },
    ];
    expect(scopeAreaLabel(listings)).toBe("Markham +1");
  });

  it("never shows a TRREB district code", () => {
    // Toronto is filed as "Toronto C15" / "Toronto E05"; both collapse to one city.
    const listings = Array.from({ length: MAX_NAMED_AREAS + 1 }, (_, i) => ({
      City: i % 2 === 0 ? "Toronto C15" : "Toronto E05",
      CityRegion: `Hood ${i}`,
    }));
    expect(scopeAreaLabel(listings)).toBe("Toronto");
  });

  it("keeps punctuation in city names intact", () => {
    const listings = Array.from({ length: MAX_NAMED_AREAS + 1 }, (_, i) => ({
      City: "Niagara-on-the-Lake",
      CityRegion: `Hood ${i}`,
    }));
    expect(scopeAreaLabel(listings)).toBe("Niagara-on-the-Lake");
  });

  it("falls back to City when the feed ships no CityRegion", () => {
    // TRREB sends no CityRegion at all for Waterloo Region / Brantford — those rows must
    // still count, naming the city rather than dropping out of the tally.
    const listings: AreaFields[] = [
      { City: "Kitchener", CityRegion: "" },
      { City: "Kitchener", CityRegion: null },
      { City: "Kitchener" },
    ];
    expect(scopeAreaLabel(listings)).toBe("Kitchener");
  });

  it("mixes a CityRegion-less market with a named one without double-counting", () => {
    const listings: AreaFields[] = [...rows(2, "", "Kitchener"), ...rows(8, "Henry Farm")];
    expect(scopeAreaLabel(listings)).toBe("Henry Farm +1");
  });

  it("ignores rows carrying no place at all", () => {
    const listings: AreaFields[] = [...rows(5, "Henry Farm"), { City: "", CityRegion: "" }, {}];
    expect(scopeAreaLabel(listings)).toBe("Henry Farm");
  });

  it("trims feed whitespace so padded names don't split the tally", () => {
    const listings: AreaFields[] = [
      { City: "Toronto C15", CityRegion: "Henry Farm" },
      { City: "Toronto C15", CityRegion: "  Henry Farm  " },
    ];
    expect(scopeAreaLabel(listings)).toBe("Henry Farm");
  });

  it("breaks ties deterministically, so row order can't change the label", () => {
    const a: AreaFields[] = [...rows(1, "Pleasant View"), ...rows(1, "Henry Farm")];
    const b: AreaFields[] = [...rows(1, "Henry Farm"), ...rows(1, "Pleasant View")];
    expect(scopeAreaLabel(a)).toBe(scopeAreaLabel(b));
    expect(scopeAreaLabel(a)).toBe("Henry Farm +1");
  });
});
