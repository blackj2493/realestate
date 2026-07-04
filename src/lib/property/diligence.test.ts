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

// ── Commercial framing (commercial-gap follow-up) ──
describe("buildDiligenceFlags — commercial", () => {
  const COMMERCIAL = { PropertyType: "Commercial", PropertySubType: "Investment" };

  it("suppresses the dwelling-only flags (suite, density, orientation)", () => {
    const flags = buildDiligenceFlags({
      ...COMMERCIAL,
      KitchensBelowGrade: 1,
      SuiteStatus: "EXISTING_SUITE",
      is_density_ready: true,
      DirectionFaces: "North",
    });
    const ids = flags.map((f) => f.id);
    expect(ids).not.toContain("suite");
    expect(ids).not.toContain("density");
    expect(ids).not.toContain("orientation");
  });

  it("older buildings get building/HVAC wording, not home/furnace", () => {
    const flag = buildDiligenceFlags({ ...COMMERCIAL, ApproximateAge: "51-99" }).find(
      (f) => f.id === "older_home"
    );
    expect(flag?.title).toBe("Older building (51-99 yrs)");
    expect(flag?.ask).toMatch(/HVAC/);
    expect(flag?.ask).not.toMatch(/furnace/);
  });

  it("rented equipment says 'property' with operating-cost framing", () => {
    const flag = buildDiligenceFlags({ ...COMMERCIAL, RentalItems: ["Compressor"] }).find(
      (f) => f.id === "rented_equipment"
    );
    expect(flag?.title).toContain("transfers with the property");
    expect(flag?.ask).toMatch(/operating costs/);
  });

  it("surfaces the permitted-use prompt from Zoning, falling back to PropertyUse", () => {
    const fromZoning = buildDiligenceFlags({ ...COMMERCIAL, Zoning: "E1.0", PropertyUse: "Industrial Condo" });
    expect(fromZoning.find((f) => f.id === "permitted_use")?.title).toBe("Listed use / zoning: E1.0");
    const fromUse = buildDiligenceFlags({ ...COMMERCIAL, PropertyUse: "Industrial Condo" });
    expect(fromUse.find((f) => f.id === "permitted_use")?.title).toBe(
      "Listed use / zoning: Industrial Condo"
    );
    // No use data at all → no flag; and residential never gets it
    expect(buildDiligenceFlags({ ...COMMERCIAL }).find((f) => f.id === "permitted_use")).toBeUndefined();
    expect(
      buildDiligenceFlags({ PropertyType: "Residential Freehold", Zoning: "R1" }).find(
        (f) => f.id === "permitted_use"
      )
    ).toBeUndefined();
  });

  it("residential wording is unchanged (regression)", () => {
    const flags = buildDiligenceFlags({
      PropertyType: "Residential Freehold",
      ApproximateAge: "51-99",
      RentalItems: ["Hot Water Tank"],
    });
    expect(flags.find((f) => f.id === "older_home")?.title).toBe("Older home (51-99 yrs)");
    expect(flags.find((f) => f.id === "rented_equipment")?.title).toContain("transfers with the home");
  });
});
