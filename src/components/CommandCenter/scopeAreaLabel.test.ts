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

  it("strips the OREB board code Ottawa carries on the region", () => {
    // The reported case: the chip read "MAP AREA · 7706 - BAR…" on a Barrhaven viewport.
    expect(scopeAreaLabel(rows(10, "7706 - Barrhaven", "Ottawa"))).toBe("Barrhaven");
  });

  it("strips the code at every width the feed ships it", () => {
    // 4-digit, 3-digit and leading-zero forms are all real (verified live on X12941486
    // for the Kanata one); the name after the dash keeps its own internal dashes.
    expect(scopeAreaLabel(rows(3, "9008 - Kanata - Morgan's Grant/South March", "Ottawa"))).toBe(
      "Kanata - Morgan's Grant/South March"
    );
    expect(scopeAreaLabel(rows(3, "551 - Kanata", "Ottawa"))).toBe("Kanata");
    expect(scopeAreaLabel(rows(3, "0140 - Churchill Meadows", "Mississauga"))).toBe("Churchill Meadows");
  });

  it("orders the tie-break by the visible name, not the hidden board code", () => {
    // Raw, "1001 - Zephyr" sorts before "9008 - Amberwood" on the digits; by the name a
    // reader sees, Amberwood wins. Normalising before the tally is what makes the
    // displayed label match the displayed ordering.
    const listings = [...rows(1, "1001 - Zephyr", "Ottawa"), ...rows(1, "9008 - Amberwood", "Ottawa")];
    expect(scopeAreaLabel(listings)).toBe("Amberwood +1");
  });

  it("does not count one neighbourhood twice when the feed varies its board code", () => {
    const listings = [...rows(5, "7706 - Barrhaven", "Ottawa"), ...rows(3, "7706 -  Barrhaven", "Ottawa")];
    expect(scopeAreaLabel(listings)).toBe("Barrhaven");
  });

  it("never leaks a TRREB district code from the region axis either", () => {
    // Guards the choice of formatRegionParts().name over formatRegionLabel(), which
    // re-attaches the code as "Toronto C01 · Downtown & Waterfront".
    const label = scopeAreaLabel(rows(4, "Toronto C01", "Toronto C01"));
    expect(label).toBe("Downtown & Waterfront");
    expect(label).not.toMatch(/C01/);
  });

  it("leaves a plain neighbourhood name untouched", () => {
    // The strip must not fire on names that merely contain digits or dashes.
    expect(scopeAreaLabel(rows(4, "Bridle Path-Sunnybrook-York Mills"))).toBe(
      "Bridle Path-Sunnybrook-York Mills"
    );
    expect(scopeAreaLabel(rows(4, "Rural Puslinch"))).toBe("Rural Puslinch");
  });

  it("breaks ties deterministically, so row order can't change the label", () => {
    const a: AreaFields[] = [...rows(1, "Pleasant View"), ...rows(1, "Henry Farm")];
    const b: AreaFields[] = [...rows(1, "Henry Farm"), ...rows(1, "Pleasant View")];
    expect(scopeAreaLabel(a)).toBe(scopeAreaLabel(b));
    expect(scopeAreaLabel(a)).toBe("Henry Farm +1");
  });
});
