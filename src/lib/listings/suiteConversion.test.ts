import { describe, it, expect } from "vitest";
import { suiteConversion, suiteConversionNote } from "./suiteConversion";
import { CONVERSION_COSTS } from "@/lib/avm/valueAdd/moveCatalog";

const house = { PropertyType: "Residential Freehold", PropertySubType: "Detached" };
const { legalSuite, finishBasement, entranceAllowance } = CONVERSION_COSTS;

describe("suiteConversion — eligibility", () => {
  it("offers the scenario on a finished basement with a separate entrance", () => {
    const c = suiteConversion({ ...house, Basement: ["Finished", "Separate Entrance"] });
    expect(c).not.toBeNull();
    expect(c!.needsEntrance).toBe(false);
    expect(c!.needsFinishing).toBe(false);
  });

  /**
   * The regression this file exists for. 44,804 active freehold listings have a
   * basement and no described entrance, and the first cut showed them nothing at all.
   */
  it("offers it on a basement with NO described entrance", () => {
    const c = suiteConversion({ ...house, Basement: ["Full", "Finished"] });
    expect(c).not.toBeNull();
    expect(c!.needsEntrance).toBe(true);
  });

  it("offers it on an unfinished basement", () => {
    // N13683094 — Markham, $2.4M, Basement ["Unfinished"], showed nothing before.
    const c = suiteConversion({ ...house, Basement: ["Unfinished"] });
    expect(c).not.toBeNull();
    expect(c!.needsFinishing).toBe(true);
    expect(c!.needsEntrance).toBe(true);
  });

  it("refuses where there is nothing to convert", () => {
    for (const b of [["None"], ["Crawl Space"], ["Half"], []]) {
      expect(suiteConversion({ ...house, Basement: b })).toBeNull();
    }
    expect(suiteConversion({ ...house, Basement: undefined })).toBeNull();
  });

  it("refuses on a home that already has a suite — that one gets Split", () => {
    expect(
      suiteConversion({ ...house, Basement: ["Finished", "Separate Entrance"], KitchensBelowGrade: 1 })
    ).toBeNull();
  });

  it("refuses on condos", () => {
    expect(suiteConversion({ PropertyType: "Residential Condo & Other", Basement: ["Finished"] })).toBeNull();
    expect(suiteConversion({ ...house, PropertySubType: "Condo Townhouse", Basement: ["Finished"] })).toBeNull();
    expect(suiteConversion({ ...house, CondoCorpNumber: 42, Basement: ["Finished"] })).toBeNull();
  });
});

describe("suiteConversion — cost scales with the work", () => {
  const cost = (b: string[]) => suiteConversion({ ...house, Basement: b })!;

  it("is the bare legal-suite band when the basement is ready", () => {
    const c = cost(["Finished", "Walk-Out"]);
    expect([c.low, c.typical, c.high]).toEqual([legalSuite.low, legalSuite.typical, legalSuite.high]);
  });

  it("adds an entrance allowance when none is described", () => {
    const c = cost(["Full", "Finished"]);
    expect(c.typical).toBe(legalSuite.typical + entranceAllowance.typical);
  });

  it("adds finishing when the basement is unfinished", () => {
    const c = cost(["Unfinished", "Separate Entrance"]);
    expect(c.typical).toBe(legalSuite.typical + finishBasement.typical);
  });

  it("adds both on the hardest case", () => {
    const c = cost(["Unfinished"]);
    expect(c.typical).toBe(legalSuite.typical + finishBasement.typical + entranceAllowance.typical);
    expect(c.high).toBe(legalSuite.high + finishBasement.high + entranceAllowance.high);
  });

  it("orders low < typical < high on every path, so the slider bounds are valid", () => {
    for (const b of [["Finished", "Walk-Out"], ["Full", "Finished"], ["Unfinished", "Walk-Up"], ["Unfinished"]]) {
      const c = cost(b);
      expect(c.low).toBeLessThan(c.typical);
      expect(c.typical).toBeLessThan(c.high);
    }
  });

  it("never costs less when there is more work to do", () => {
    expect(cost(["Unfinished"]).typical).toBeGreaterThan(cost(["Finished", "Walk-Out"]).typical);
  });
});

describe("suiteConversionNote", () => {
  it("names the assumptions it is making", () => {
    const note = suiteConversionNote(suiteConversion({ ...house, Basement: ["Unfinished"] })!);
    expect(note).toContain("finishing the basement");
    expect(note).toContain("separate entrance");
  });

  it("warns that an entrance is not always possible", () => {
    // The feed cannot see grading or setbacks, so the copy must not imply it can.
    expect(suiteConversionNote(suiteConversion({ ...house, Basement: ["Full"] })!)).toMatch(/cannot take an entrance/i);
  });

  it("claims nothing extra when the basement is already suite-ready", () => {
    const note = suiteConversionNote(suiteConversion({ ...house, Basement: ["Finished", "Separate Entrance"] })!);
    expect(note).not.toMatch(/adding|finishing/i);
  });
});
