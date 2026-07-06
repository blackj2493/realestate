import { describe, it, expect } from "vitest";
import { geoFlagsFor } from "./geoFlags";
import { ACTIVE_DATASETS, GEO_DATASETS } from "./geoDatasets";

describe("geoFlagsFor — intersect (polygon) flags", () => {
  it("flags a listing inside a regulated floodplain", () => {
    const flags = geoFlagsFor({ inside: { flood: true } });
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

  it("flags a Provincially Significant Wetland and conservation-regulated area", () => {
    const flags = geoFlagsFor({ inside: { wetland: true, conservation_regulated: true } });
    expect(flags.map((f) => f.id).sort()).toEqual(["conservation_regulated", "wetland"]);
  });

  it("flags a Toronto Heritage Conservation District", () => {
    const flags = geoFlagsFor({ inside: { heritage_district: true } });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      id: "heritage_district",
      kind: "warn",
      severity: 48,
      title: "Within a Toronto Heritage Conservation District",
      source: "City of Toronto — Heritage Conservation Districts",
    });
    expect(flags[0].ask).toMatch(/district plan/i);
  });

  it("emits nothing when not inside, or for non-true values", () => {
    expect(geoFlagsFor({ inside: { flood: false } })).toEqual([]);
    expect(geoFlagsFor({ inside: { flood: null } })).toEqual([]);
    expect(geoFlagsFor({})).toEqual([]);
    expect(geoFlagsFor({ inside: {} })).toEqual([]);
  });
});

describe("geoFlagsFor — distance (line/point) flags", () => {
  it("flags hydro proximity and rounds the distance", () => {
    const flags = geoFlagsFor({ distanceM: { hydro: 88.6 } });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ id: "hydro", kind: "warn", severity: 34 });
    expect(flags[0].title).toBe("89 m from a hydro transmission corridor");
  });

  it("treats transit as an info (upside) flag", () => {
    const flags = geoFlagsFor({ distanceM: { transit: 350 } });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ id: "transit", kind: "info" });
    expect(flags[0].title).toBe("350 m to a GO/subway station");
    expect(flags[0].ask).toBeUndefined();
  });

  it("does not flag beyond the threshold, or for null/NaN", () => {
    expect(geoFlagsFor({ distanceM: { hydro: 9999 } })).toEqual([]); // > 150 m
    expect(geoFlagsFor({ distanceM: { rail: null } })).toEqual([]);
    expect(geoFlagsFor({ distanceM: { rail: Number.NaN } })).toEqual([]);
  });
});

describe("geoFlagsFor — registry integrity", () => {
  it("never emits a flag for a disabled dataset (e.g. traffic)", () => {
    const flags = geoFlagsFor({ inside: { traffic: true }, distanceM: { traffic: 10 } });
    expect(flags).toEqual([]);
  });

  it("every active dataset has a unique flag id and a non-empty source", () => {
    const ids = ACTIVE_DATASETS.map((d) => d.flag.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of ACTIVE_DATASETS) {
      expect(d.flag.source.trim().length).toBeGreaterThan(0);
      expect(d.sources.length).toBeGreaterThan(0);
    }
  });

  it("traffic is registered but disabled", () => {
    expect(GEO_DATASETS.find((d) => d.kind === "traffic")?.enabled).toBe(false);
  });

  it("combined signals produce one flag per matching ACTIVE dataset (rsc disabled)", () => {
    const flags = geoFlagsFor({
      inside: { flood: true, greenbelt: true },
      distanceM: { hydro: 40, rsc: 20, transit: 600 },
    });
    // rsc is signalled but disabled (license pending) → excluded from output.
    expect(flags.map((f) => f.id).sort()).toEqual(["flood", "greenbelt", "hydro", "transit"]);
  });

  it("rsc is registered but disabled (license pending MECP)", () => {
    expect(GEO_DATASETS.find((d) => d.kind === "rsc")?.enabled).toBe(false);
    expect(geoFlagsFor({ distanceM: { rsc: 10 } })).toEqual([]);
  });
});
