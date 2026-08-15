import { describe, it, expect } from "vitest";
import { cleanAreaName, displayArea } from "./areaNames";

/**
 * 308 of 1,033 distinct TRREB areas ship with an MLS district code the feed never strips.
 * Published in a table, "1011 - MO Morrison" reads as a database leak. These cases are taken
 * from the live distinct set, including every name that ends up shortest after cleaning —
 * those are the ones a careless regex would eat.
 *
 * These helpers were extracted from rentBoard.ts when the over-asking tracker landed, so that
 * two public trackers cannot render the same neighbourhood under two different names.
 */
describe("cleanAreaName", () => {
  it("strips a plain numeric district code", () => {
    expect(cleanAreaName("057 - Smithville")).toBe("Smithville");
    expect(cleanAreaName("768 - Welland Downtown")).toBe("Welland Downtown");
  });

  it("strips the Oakville-style code plus its two-letter abbreviation", () => {
    expect(cleanAreaName("1011 - MO Morrison")).toBe("Morrison");
    expect(cleanAreaName("1008 - GO Glenorchy")).toBe("Glenorchy");
    expect(cleanAreaName("1000 - BC Bronte Creek")).toBe("Bronte Creek");
    expect(cleanAreaName("1022 - WT West Oak Trails")).toBe("West Oak Trails");
  });

  it("keeps hyphenated sub-areas readable", () => {
    expect(cleanAreaName("7711 - Barrhaven - Half Moon Bay")).toBe("Barrhaven - Half Moon Bay");
    expect(cleanAreaName("9010 - Kanata - Emerald Meadows/Trailwest")).toBe(
      "Kanata - Emerald Meadows/Trailwest"
    );
  });

  it("leaves uncoded names completely alone", () => {
    for (const name of [
      "Churchill Meadows",
      "Rosedale-Moore Park",
      "Dovercourt-Wallace Emerson-Junction",
      "Runnymede-Bloor West Village",
      "Annex",
      "Fletcher's Meadow",
    ]) {
      expect(cleanAreaName(name)).toBe(name);
    }
  });

  it("never strips a two-letter opening word when there was no numeric code", () => {
    // The abbreviation strip is what makes "MO Morrison" readable, and it is exactly what
    // would eat the first word of an uncoded name. It is gated on the code being present.
    expect(cleanAreaName("St Clair West")).toBe("St Clair West");
    expect(cleanAreaName("Mt Pleasant Village")).toBe("Mt Pleasant Village");
  });

  it("keeps the short real names that a greedy strip would destroy", () => {
    // Every one of these is a genuine neighbourhood, not a fragment.
    expect(cleanAreaName("4402 - Glebe")).toBe("Glebe");
    expect(cleanAreaName("101 - Town")).toBe("Town");
    expect(cleanAreaName("9104 - Carp")).toBe("Carp");
  });

  it("never returns empty, whatever it is handed", () => {
    expect(cleanAreaName("")).toBe("");
    expect(cleanAreaName("   ")).toBe("");
    // A code with nothing after it must fall back to something rather than vanish.
    expect(cleanAreaName("1011 - ")).toBe("1011 -");
  });
});

describe("displayArea", () => {
  it("falls back to the city when the feed ships no CityRegion", () => {
    // Waterloo Region and Brantford arrive with an empty area on both sides of the feed.
    // 542 Waterloo sales would otherwise render under a blank neighbourhood name.
    expect(displayArea("", "Waterloo")).toBe("Waterloo (all areas)");
    expect(displayArea("   ", "Brantford")).toBe("Brantford (all areas)");
  });

  it("passes a real area through cleaned", () => {
    expect(displayArea("057 - Smithville", "West Lincoln")).toBe("Smithville");
  });
});
