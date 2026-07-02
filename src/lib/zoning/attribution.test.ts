import { describe, it, expect } from "vitest";
import { ZONING_SOURCES, zoningSource, zoningLabel, ZONING_DISCLAIMER } from "./attribution";

describe("zoning attribution registry", () => {
  it("resolves a known source with correct attribution", () => {
    const s = zoningSource("toronto");
    expect(s?.municipality).toBe("City of Toronto");
    expect(s?.bylaw).toBe("Zoning By-law 569-2013");
    expect(s?.attribution).toBe("Contains information licensed under the Open Government Licence – Toronto.");
  });

  it("returns null for absent or unknown keys", () => {
    expect(zoningSource(undefined)).toBeNull();
    expect(zoningSource(null)).toBeNull();
    expect(zoningSource("")).toBeNull();
    expect(zoningSource("not-a-real-place")).toBeNull();
  });

  it("every source is well-formed (key matches, all fields present, attribution phrasing)", () => {
    for (const [key, s] of Object.entries(ZONING_SOURCES)) {
      expect(s.key).toBe(key);
      expect(s.municipality).toBeTruthy();
      expect(s.bylaw).toBeTruthy();
      expect(s.license).toBeTruthy();
      expect(s.attribution).toContain("Contains information licensed under the ");
      expect(s.attribution).toContain(s.license);
    }
  });

  it("covers the Phase-1 commercial-clear set (26 municipalities)", () => {
    const expected = [
      "toronto", "hamilton", "london", "oakville", "barrie", "burlington", "oshawa", "kingston", "milton", "niagara-falls",
      "springwater", "innisfil", "oro-medonte", "tiny", "clearview", "wasaga-beach", "severn", "midland", "ramara", "new-tecumseth", "bradford-west-gwillimbury",
      "north-frontenac", "central-frontenac", "south-frontenac", "frontenac-islands",
    ];
    for (const k of expected) expect(ZONING_SOURCES[k], `missing source: ${k}`).toBeDefined();
    expect(Object.keys(ZONING_SOURCES).length).toBe(expected.length);
  });

  it("Simcoe/Frontenac townships share their county OGL", () => {
    expect(zoningSource("wasaga-beach")?.license).toBe("Open Government Licence – Simcoe County");
    expect(zoningSource("south-frontenac")?.license).toBe("Open Government Licence – County of Frontenac");
  });

  it("formats a provenance label", () => {
    expect(zoningLabel(zoningSource("toronto")!)).toBe("City of Toronto · Zoning By-law 569-2013");
  });

  it("has a not-a-legal-survey disclaimer", () => {
    expect(ZONING_DISCLAIMER).toContain("not a legal survey");
  });
});
