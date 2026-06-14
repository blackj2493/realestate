import { describe, it, expect } from "vitest";
import { geoFlagsFor, RAIL_PROXIMITY_M, BUSY_ROAD_AADT } from "./geoFlags";

describe("geoFlagsFor — flood", () => {
  it("flags a listing inside a regulated floodplain", () => {
    const flags = geoFlagsFor({ in_flood: true });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      id: "flood",
      kind: "warn",
      severity: 70,
      title: "Within a regulated floodplain",
      source: "TRCA floodplain mapping",
    });
    expect(flags[0].ask).toBeTruthy();
  });

  it("emits nothing when not in a floodplain", () => {
    expect(geoFlagsFor({ in_flood: false })).toEqual([]);
    expect(geoFlagsFor({})).toEqual([]);
    expect(geoFlagsFor({ in_flood: null })).toEqual([]);
    // defensively: only a strict boolean true fires the flag
    expect(geoFlagsFor({ in_flood: undefined })).toEqual([]);
  });
});

describe("geoFlagsFor — rail proximity", () => {
  it("flags when nearer than the threshold and rounds the distance", () => {
    const flags = geoFlagsFor({ rail_m: 88.6 });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ id: "rail", kind: "warn", severity: 40 });
    expect(flags[0].title).toBe("89 m from a rail corridor");
  });

  it("does not flag at or beyond the threshold, or when absent", () => {
    expect(geoFlagsFor({ rail_m: RAIL_PROXIMITY_M })).toEqual([]); // strict <
    expect(geoFlagsFor({ rail_m: 300 })).toEqual([]);
    expect(geoFlagsFor({ rail_m: null })).toEqual([]);
    expect(geoFlagsFor({ rail_m: Number.NaN })).toEqual([]);
  });
});

describe("geoFlagsFor — busy road (AADT)", () => {
  it("flags at or above the AADT threshold with a grouped number", () => {
    const flags = geoFlagsFor({ near_aadt: 12500 });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ id: "traffic", kind: "warn", severity: 38 });
    expect(flags[0].title).toBe("Fronts a busy road (~12,500 vehicles/day)");
  });

  it("does not flag below threshold or when absent", () => {
    expect(geoFlagsFor({ near_aadt: BUSY_ROAD_AADT - 1 })).toEqual([]);
    expect(geoFlagsFor({ near_aadt: null })).toEqual([]);
    expect(geoFlagsFor({ near_aadt: Number.NaN })).toEqual([]);
  });
});

describe("geoFlagsFor — combined", () => {
  it("returns every applicable flag (order/sort is buildDiligenceFlags' job)", () => {
    const flags = geoFlagsFor({ in_flood: true, rail_m: 50, near_aadt: 20000 });
    expect(flags.map((f) => f.id).sort()).toEqual(["flood", "rail", "traffic"]);
  });
});
