import { describe, expect, it } from "vitest";
import { buildDatasheet, type RawPayload } from "./datasheet";

/** Realistic detached-house payload (subset of a real IDX response shape). */
const DETACHED: RawPayload = {
  PropertySubType: "Detached",
  PropertyType: "Residential",
  ArchitecturalStyle: ["2-Storey"],
  ApproximateAge: "16-30",
  LotWidth: 46,
  LotDepth: 117.25,
  LotSizeUnits: "Feet",
  DirectionFaces: "West",
  HeatType: "Forced Air",
  HeatSource: "Electric",
  Cooling: ["Central Air"],
  Basement: ["Full", "Finished"],
  KitchensTotal: 1,
  KitchensAboveGrade: 1,
  KitchensBelowGrade: 0,
  RoomsAboveGrade: 10,
  RoomsBelowGrade: 4,
  BedroomsTotal: 4,
  BedroomsAboveGrade: 4,
  BedroomsBelowGrade: 0,
};

function rows(payload: RawPayload, groupId: string) {
  const g = buildDatasheet(payload).find((x) => x.group.id === groupId);
  return g ? g.rows : [];
}

function rowValue(payload: RawPayload, groupId: string, label: string) {
  return rows(payload, groupId).find((r) => r.label === label)?.value;
}

describe("buildDatasheet — vitals", () => {
  it("renders the absorbed Structural Vitals / Property Summary rows", () => {
    expect(rowValue(DETACHED, "vitals", "Property Type")).toBe("Detached");
    expect(rowValue(DETACHED, "vitals", "Style")).toBe("2-Storey");
    expect(rowValue(DETACHED, "vitals", "Property Age")).toBe("16-30");
    expect(rowValue(DETACHED, "vitals", "Lot Dimensions")).toBe("46 x 117.25 Feet");
    expect(rowValue(DETACHED, "vitals", "Direction Faces")).toBe("West");
    expect(rowValue(DETACHED, "vitals", "Heating")).toBe("Forced Air · Electric");
    expect(rowValue(DETACHED, "vitals", "Cooling")).toBe("Central Air");
    expect(rowValue(DETACHED, "vitals", "Basement")).toBe("Full · Finished");
    expect(rowValue(DETACHED, "vitals", "Kitchens")).toBe("1 (1 above · 0 below)");
    expect(rowValue(DETACHED, "vitals", "Rooms")).toBe("10 above · 4 below");
    expect(rowValue(DETACHED, "vitals", "Bedrooms")).toBe("4 above · 0 below");
  });

  it("omits rows for missing values and drops empty groups entirely", () => {
    const sheet = buildDatasheet({});
    expect(sheet).toEqual([]);
  });

  it("never throws on garbage payloads", () => {
    const garbage: RawPayload = {
      Cooling: [null, 42, { nested: true }, "Central Air", ""],
      Basement: "Finished",
      LotWidth: "not-a-number",
      ArchitecturalStyle: 7,
      KitchensTotal: null,
    };
    const sheet = buildDatasheet(garbage);
    expect(rowValue(garbage, "vitals", "Cooling")).toBe("42 · Central Air");
    expect(rowValue(garbage, "vitals", "Basement")).toBe("Finished");
    expect(rowValue(garbage, "vitals", "Lot Dimensions")).toBeUndefined();
    expect(sheet.every((g) => g.rows.length > 0)).toBe(true);
  });

  it("passes values through verbatim (odd casing/spacing preserved modulo trim)", () => {
    const p: RawPayload = { ApproximateAge: "  New  ", DirectionFaces: "wEsT" };
    expect(rowValue(p, "vitals", "Property Age")).toBe("New");
    expect(rowValue(p, "vitals", "Direction Faces")).toBe("wEsT");
  });
});

describe("buildDatasheet — composite rows render known segments only", () => {
  it("Rooms: only the segments the feed asserted, no fabricated zeros", () => {
    expect(rowValue({ RoomsAboveGrade: 10 }, "vitals", "Rooms")).toBe("10 above");
    expect(rowValue({ RoomsBelowGrade: 4 }, "vitals", "Rooms")).toBe("4 below");
  });

  it("Bedrooms: plain BedroomsTotal fallback gets no above/below labels", () => {
    expect(rowValue({ BedroomsTotal: 5, BedroomsBelowGrade: 1 }, "vitals", "Bedrooms")).toBe("5");
    expect(rowValue({ BedroomsAboveGrade: 3 }, "vitals", "Bedrooms")).toBe("3 above");
  });

  it("Kitchens: parenthetical lists only known segments; all-zero row is dropped", () => {
    expect(rowValue({ KitchensTotal: 2, KitchensAboveGrade: 2 }, "vitals", "Kitchens")).toBe(
      "2 (2 above)",
    );
    expect(
      rowValue(
        { KitchensTotal: 0, KitchensAboveGrade: 0, KitchensBelowGrade: 0 },
        "vitals",
        "Kitchens",
      ),
    ).toBeUndefined();
  });
});

describe("buildDatasheet — order normalization (append-remainder)", () => {
  it("a partial order never removes unlisted groups", () => {
    // "taxes" has no registry fields yet (Task 2), so it resolves empty and is
    // dropped — but vitals must still render via the appended remainder.
    const ids = buildDatasheet(DETACHED, ["taxes"]).map((g) => g.group.id);
    expect(ids).toEqual(["vitals"]);
  });

  it("duplicate ids in order render the group only once", () => {
    const ids = buildDatasheet(DETACHED, ["vitals", "vitals"]).map((g) => g.group.id);
    expect(ids).toEqual(["vitals"]);
  });
});
