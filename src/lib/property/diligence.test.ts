import { describe, it, expect } from "vitest";
import { buildDiligenceFlags, type DiligenceFlag } from "./diligence";

describe("buildDiligenceFlags", () => {
  it("surfaces easements, rented equipment and waterfront as warnings", () => {
    const flags = buildDiligenceFlags({
      Disclosures: ["Easement", "Unknown"],
      RentalItems: ["Hot Water Tank"],
      WaterfrontYN: true,
    });
    const ids = flags.map((f) => f.id);
    expect(ids).toContain("easements");
    expect(ids).toContain("rented_equipment");
    expect(ids).toContain("waterfront");
    expect(flags.every((f) => f.kind === "warn")).toBe(true);
    // every flag is attributable
    expect(flags.every((f) => f.source.length > 0)).toBe(true);
  });

  it("filters benign disclosure values (no flag from None/Unknown)", () => {
    const flags = buildDiligenceFlags({ Disclosures: ["None"], SpecialDesignation: ["Unknown"] });
    expect(flags).toHaveLength(0);
  });

  it("flags suite potential and north orientation as info", () => {
    const flags = buildDiligenceFlags({ KitchensBelowGrade: 1, DirectionFaces: "North" });
    expect(flags.find((f) => f.id === "suite")?.kind).toBe("info");
    expect(flags.find((f) => f.id === "orientation")?.title).toMatch(/north/i);
  });

  it("sorts warnings before info", () => {
    const flags = buildDiligenceFlags({ KitchensBelowGrade: 1, Disclosures: ["Easement"] });
    expect(flags[0].kind).toBe("warn"); // easement (sev 55) before suite info (26)
  });

  it("merges external geo-joined flags and ranks by severity", () => {
    const ext: DiligenceFlag[] = [
      { id: "flood", kind: "warn", severity: 70, title: "In a flood screening zone", source: "TRCA" },
    ];
    const flags = buildDiligenceFlags({ DirectionFaces: "North" }, ext);
    expect(flags[0].id).toBe("flood"); // sev 70 leads
  });

  it("is deterministic", () => {
    const p = { Disclosures: ["Easement"], KitchensBelowGrade: 1, DirectionFaces: "North" };
    expect(buildDiligenceFlags(p)).toEqual(buildDiligenceFlags(p));
  });
});
