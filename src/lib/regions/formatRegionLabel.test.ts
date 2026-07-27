import { describe, it, expect } from "vitest";
import { formatRegionLabel, formatRegionParts } from "./formatRegionLabel";
import { expandableCityGroupFor } from "./cityGroups";

describe("formatRegionLabel", () => {
  it("maps a Toronto district code to code + neighbourhoods", () => {
    expect(formatRegionLabel("Toronto C01")).toBe("Toronto C01 · Downtown & Waterfront");
    expect(formatRegionLabel("Toronto E01")).toBe("Toronto E01 · Riverdale & Leslieville");
    expect(formatRegionLabel("Toronto W01")).toBe("Toronto W01 · High Park & Roncesvalles");
  });

  it("exposes the code and name separately via formatRegionParts", () => {
    expect(formatRegionParts("Toronto C09")).toEqual({
      raw: "Toronto C09",
      code: "Toronto C09",
      name: "Rosedale & Moore Park",
    });
  });

  it("strips the OREB numeric board prefix from Ottawa area names", () => {
    expect(formatRegionLabel("7711 - Barrhaven - Half Moon Bay")).toBe("Barrhaven - Half Moon Bay");
    expect(formatRegionParts("551 - Kanata")).toEqual({ raw: "551 - Kanata", name: "Kanata" });
  });

  it("passes through an unmapped / plain region unchanged", () => {
    expect(formatRegionLabel("Milton")).toBe("Milton");
    expect(formatRegionLabel("Hamilton")).toBe("Hamilton");
    // TREB has no C05 — no guess, keep the bare code.
    expect(formatRegionLabel("Toronto C05")).toBe("Toronto C05");
    // Bare parent city (a CITY_GROUPS key) is not a district → unchanged.
    expect(formatRegionLabel("Toronto")).toBe("Toronto");
  });

  it('keeps "" as ""', () => {
    expect(formatRegionLabel("")).toBe("");
    expect(formatRegionParts("")).toEqual({ raw: "", name: "" });
  });

  it("never mangles a unit-dash street address (guards the OREB strip)", () => {
    // The dash is followed by a digit → the board-code strip must not fire.
    expect(formatRegionLabel("12 - 100 Main St")).toBe("12 - 100 Main St");
  });
});

describe("expandableCityGroupFor", () => {
  it("resolves a full-text-expandable parent from a prefix", () => {
    expect(expandableCityGroupFor("tor")).toBe("Toronto");
    expect(expandableCityGroupFor("Toronto")).toBe("Toronto");
    expect(expandableCityGroupFor("lond")).toBe("London");
  });

  it("does NOT offer Ottawa (its OREB areas don't contain the parent name)", () => {
    expect(expandableCityGroupFor("ottawa")).toBeNull();
  });

  it("returns null for a non-group city and for too-short input", () => {
    expect(expandableCityGroupFor("Milton")).toBeNull();
    expect(expandableCityGroupFor("t")).toBeNull();
    expect(expandableCityGroupFor("")).toBeNull();
  });
});
