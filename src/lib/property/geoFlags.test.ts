import { describe, it, expect } from "vitest";
import { geoFlagsFor, mergeDatasetFlag } from "./geoFlags";
import { ACTIVE_DATASETS, GEO_DATASETS, buildGeoFlag } from "./geoDatasets";

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

  it("treats dev_application as an info (context) flag with no diligence question", () => {
    const flags = geoFlagsFor({ distanceM: { dev_application: 180 } });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ id: "dev_application", kind: "info", severity: 26 });
    expect(flags[0].title).toBe("Major development application filed ~180 m away");
    expect(flags[0].ask).toBeUndefined();
  });

  it("does not flag a dev_application beyond its 300 m threshold", () => {
    expect(geoFlagsFor({ distanceM: { dev_application: 301 } })).toEqual([]);
  });

  it("treats major_construction as an info flag with a diligence question", () => {
    const flags = geoFlagsFor({ distanceM: { major_construction: 120 } });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ id: "major_construction", kind: "info", severity: 30 });
    expect(flags[0].title).toBe("Recent major construction permit issued ~120 m away");
    expect(flags[0].ask).toBeTruthy();
  });

  it("does not flag major_construction beyond its 300 m guard ceiling", () => {
    expect(geoFlagsFor({ distanceM: { major_construction: 301 } })).toEqual([]);
  });

  it("does not flag beyond the threshold, or for null/NaN", () => {
    expect(geoFlagsFor({ distanceM: { hydro: 9999 } })).toEqual([]); // > 150 m
    expect(geoFlagsFor({ distanceM: { rail: null } })).toEqual([]);
    expect(geoFlagsFor({ distanceM: { rail: Number.NaN } })).toEqual([]);
  });
});

describe("geoFlagsFor — descriptor (what the nearby permit / application is)", () => {
  it("names a major_construction permit from the nearest feature's work type", () => {
    const flags = geoFlagsFor({
      distanceM: { major_construction: 120 },
      nearestAttrs: { major_construction: { WORKDESC: "Demolition" } },
    });
    expect(flags[0].title).toBe("Demolition permit issued ~120 m away");
  });

  it("names a dev_application from the nearest feature's application type", () => {
    const flags = geoFlagsFor({
      distanceM: { dev_application: 180 },
      nearestAttrs: { dev_application: { APPL_TYPE: "Zoning By-law Amendment" } },
    });
    expect(flags[0].title).toBe("Zoning amendment filed ~180 m away");
  });

  it("falls back to the generic title when the nearest feature's type is unrecognized", () => {
    const flags = geoFlagsFor({
      distanceM: { dev_application: 180 },
      nearestAttrs: { dev_application: { APPL_TYPE: "Some Weird Internal Code" } },
    });
    expect(flags[0].title).toBe("Major development application filed ~180 m away");
  });

  it("falls back to the generic title when nearestAttrs is absent (parity with pre-feature output)", () => {
    expect(geoFlagsFor({ distanceM: { major_construction: 120 } })[0].title).toBe(
      "Recent major construction permit issued ~120 m away",
    );
  });

  it("ignores nearestAttrs supplied for a non-descriptor dataset", () => {
    const flags = geoFlagsFor({
      distanceM: { hydro: 88.6 },
      nearestAttrs: { hydro: { WORKDESC: "New" } },
    });
    expect(flags[0].title).toBe("89 m from a hydro transmission corridor");
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

describe("mergeDatasetFlag — single-dataset targeted refresh (enrichGeoFlags --dataset)", () => {
  const devDs = ACTIVE_DATASETS.find((d) => d.kind === "dev_application")!;

  it("is byte-identical to a full recompute when it ADDS the flag", () => {
    // Listing already flagged flood + greenbelt + hydro; now a dev application is filed 120 m away.
    const existing = geoFlagsFor({ inside: { flood: true, greenbelt: true }, distanceM: { hydro: 40 } });
    const merged = mergeDatasetFlag(existing, "dev_application", buildGeoFlag(devDs, 120));
    const fullRecompute = geoFlagsFor({
      inside: { flood: true, greenbelt: true },
      distanceM: { hydro: 40, dev_application: 120 },
    });
    expect(merged).toEqual(fullRecompute);
    // dev_application is the last active dataset → always appended last, never mid-array.
    expect(merged[merged.length - 1].id).toBe("dev_application");
  });

  it("CLEARS the flag (newFlag = null) and leaves the other flags untouched + in order", () => {
    const existing = geoFlagsFor({
      inside: { flood: true, greenbelt: true },
      distanceM: { hydro: 40, dev_application: 120 },
    });
    const merged = mergeDatasetFlag(existing, "dev_application", null);
    const fullRecompute = geoFlagsFor({ inside: { flood: true, greenbelt: true }, distanceM: { hydro: 40 } });
    expect(merged).toEqual(fullRecompute);
    expect(merged.some((f) => f.id === "dev_application")).toBe(false);
  });

  it("REPLACES an existing flag's distance without disturbing the others", () => {
    const existing = geoFlagsFor({ inside: { flood: true }, distanceM: { dev_application: 250 } });
    const merged = mergeDatasetFlag(existing, "dev_application", buildGeoFlag(devDs, 90));
    expect(merged).toEqual(geoFlagsFor({ inside: { flood: true }, distanceM: { dev_application: 90 } }));
    expect(merged.find((f) => f.id === "dev_application")?.title).toBe(
      "Major development application filed ~90 m away",
    );
  });

  it("is byte-identical to a full recompute when the flag carries a DESCRIPTOR (no churn)", () => {
    // The targeted refresh builds buildGeoFlag(ds, dist, descriptor) and merges it; the full
    // sweep builds the same flag via geoFlagsFor + nearestAttrs. They must match exactly, or a
    // weekly --dataset refresh would flip the title back and forth against the nightly sweep.
    const attrs = { APPL_TYPE: "Draft Plan of Subdivision" };
    const merged = mergeDatasetFlag(
      geoFlagsFor({ inside: { flood: true } }),
      "dev_application",
      buildGeoFlag(devDs, 90, "Plan of subdivision"),
    );
    const fullRecompute = geoFlagsFor({
      inside: { flood: true },
      distanceM: { dev_application: 90 },
      nearestAttrs: { dev_application: attrs },
    });
    expect(merged).toEqual(fullRecompute);
    expect(merged.find((f) => f.id === "dev_application")?.title).toBe("Plan of subdivision filed ~90 m away");
  });

  it("preserves the asOf provenance stamped on the recomputed flag", () => {
    const stamped = { ...buildGeoFlag(devDs, 100), asOf: "2026-07-16" };
    const merged = mergeDatasetFlag([], "dev_application", stamped);
    expect(merged).toEqual([stamped]);
  });

  it("no-ops to an empty array when clearing a listing that had no flags", () => {
    expect(mergeDatasetFlag([], "dev_application", null)).toEqual([]);
  });
});
