import { describe, it, expect } from "vitest";
import { boundsAroundPoint, buildSoldQuery } from "./fetchSoldComps";

describe("buildSoldQuery", () => {
  it("uses the viewport as a 4-corner polygon (lat,lng pairs) when bounds exist", () => {
    const qs = buildSoldQuery({
      mapBounds: { north: 44, south: 43, east: -79, west: -80 },
      location: "Toronto",
      windowDays: 90,
      limit: 100,
      dealType: "sold",
    });
    const p = new URLSearchParams(qs);
    // S,W, S,E, N,E, N,W
    expect(p.get("polygon")).toBe("43,-80,43,-79,44,-79,44,-80");
    expect(p.get("windowDays")).toBe("90");
    expect(p.get("limit")).toBe("100");
    expect(p.get("region")).toBeNull();
  });

  it("falls back to region=location when no bounds", () => {
    const qs = buildSoldQuery({ mapBounds: null, location: "Brampton", windowDays: 180, limit: 100, dealType: "sold" });
    const p = new URLSearchParams(qs);
    expect(p.get("region")).toBe("Brampton");
    expect(p.get("polygon")).toBeNull();
  });

  it("clamps the window to the cap", () => {
    const qs = buildSoldQuery({ mapBounds: null, location: "Ajax", windowDays: 9999, limit: 100, dealType: "sold" });
    expect(new URLSearchParams(qs).get("windowDays")).toBe("180");
  });

  it("returns an empty string when there is neither bounds nor location", () => {
    expect(buildSoldQuery({ mapBounds: null, location: "", windowDays: 90, limit: 100, dealType: "sold" })).toBe("");
  });

  it("includes dealType in the query string", () => {
    expect(buildSoldQuery({ mapBounds: null, location: "Toronto", windowDays: 90, limit: 100, dealType: "sold" })).toContain("dealType=sold");
  });

  it("passes the price band through when set", () => {
    const qs = buildSoldQuery({
      mapBounds: null,
      location: "Toronto",
      windowDays: 90,
      limit: 100,
      dealType: "sold",
      filters: { minPrice: 500_000, maxPrice: 800_000 },
    });
    const p = new URLSearchParams(qs);
    expect(p.get("minPrice")).toBe("500000");
    expect(p.get("maxPrice")).toBe("800000");
  });

  it("omits price params when the band is unset", () => {
    const qs = buildSoldQuery({ mapBounds: null, location: "Toronto", windowDays: 90, limit: 100, dealType: "sold" });
    const p = new URLSearchParams(qs);
    expect(p.get("minPrice")).toBeNull();
    expect(p.get("maxPrice")).toBeNull();
  });
});

describe("boundsAroundPoint", () => {
  it("boxes ~2 km around the point (pin fallback while the fly-to is in transit)", () => {
    const b = boundsAroundPoint(43.6532, -79.3832);
    expect(b.north).toBeCloseTo(43.6732);
    expect(b.south).toBeCloseTo(43.6332);
    expect(b.east).toBeCloseTo(-79.3532);
    expect(b.west).toBeCloseTo(-79.4132);
  });

  it("feeds buildSoldQuery a polygon (never the empty-string dead end)", () => {
    const qs = buildSoldQuery({
      mapBounds: boundsAroundPoint(43.6532, -79.3832),
      location: "",
      windowDays: 90,
      limit: 100,
      dealType: "sold",
    });
    expect(qs).not.toBe("");
    const poly = new URLSearchParams(qs).get("polygon");
    expect(poly).not.toBeNull();
    const nums = poly!.split(",").map(Number);
    expect(nums).toHaveLength(8);
    expect(nums[0]).toBeCloseTo(43.6332); // S
    expect(nums[1]).toBeCloseTo(-79.4132); // W
  });
});
