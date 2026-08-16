import { describe, it, expect } from "vitest";
import {
  areaFilter,
  regionArea,
  COMMUNITY_ALIASES,
  QUICK_PICK_MARKETS,
  regionCamera,
  regionMapHref,
} from "./area";

describe("areaFilter — region resolution", () => {
  it("expands an umbrella community to its CityRegion members (Woodbridge → East/West)", () => {
    // The bug this guards: a bare "Woodbridge" exact-matched no facet value → 0/0 dashboard.
    expect(areaFilter(regionArea("Woodbridge"))).toBe(
      "CityRegion:=[`East Woodbridge`, `West Woodbridge`]"
    );
  });

  it("expands a CITY_GROUPS parent to its City members (Toronto → districts), one filter op", () => {
    const f = areaFilter(regionArea("Toronto"));
    expect(f.startsWith("City:=[")).toBe(true);
    expect(f).toContain("`Toronto`");
    expect(f).toContain("`Toronto C01`");
    // IN form only — no || fan-out, so the 100-op filter_by ceiling holds for big groups.
    expect(f).not.toContain("||");
  });

  it("resolves a real CityRegion member via exact match, unchanged", () => {
    expect(areaFilter(regionArea("East Woodbridge"))).toBe(
      "(City:=`East Woodbridge` || CityRegion:=`East Woodbridge`)"
    );
  });

  it("a plain city (no group, no alias) uses the exact City||CityRegion match", () => {
    expect(areaFilter(regionArea("Mississauga"))).toBe(
      "(City:=`Mississauga` || CityRegion:=`Mississauga`)"
    );
  });

  it("strips backticks from a region name defensively", () => {
    expect(areaFilter(regionArea("Bad`Name"))).toBe(
      "(City:=`BadName` || CityRegion:=`BadName`)"
    );
  });

  it("every COMMUNITY_ALIASES entry has at least one member (a bare umbrella never yields nothing)", () => {
    for (const [name, members] of Object.entries(COMMUNITY_ALIASES)) {
      expect(members.length, `${name} must expand to ≥1 CityRegion member`).toBeGreaterThan(0);
    }
  });
});

/**
 * These guard a regression that has now shipped twice: a saved region with no camera fell
 * back to setLocation(region) — a Typesense TEXT filter — so the terminal opened pinned to
 * that place on every page load, login included. Fixed for the eight quick-pick metros
 * after the 2026-07-28 Vaughan report; community-scale names (Barrhaven) kept reproducing
 * it because nothing consulted the finer centroid table.
 */
describe("regionCamera — a saved region must open by camera, not a place filter", () => {
  it("resolves Barrhaven (the reported case) rather than returning null", () => {
    // Null here is the bug: callers turn it into a place filter the user never typed.
    const cam = regionCamera("Barrhaven");
    expect(cam, "Barrhaven must have a camera or the terminal opens filtered").not.toBeNull();
    // Sanity-check it's actually Ottawa's south end, not a stray row.
    expect(cam!.lat).toBeCloseTo(45.276, 2);
    expect(cam!.lng).toBeCloseTo(-75.719, 2);
  });

  it("prefers the hand-tuned quick-pick camera over the centroid table", () => {
    // Both lists contain Hamilton/Brampton/Markham/Mississauga; the quick pick carries a
    // per-market zoom, so it must win rather than falling through to COMMUNITY_ZOOM.
    const pick = QUICK_PICK_MARKETS.find((m) => m.name === "Hamilton")!;
    expect(regionCamera("Hamilton")).toEqual({ lat: pick.lat, lng: pick.lng, zoom: pick.zoom });
  });

  it("frames a community tighter than a whole metro", () => {
    expect(regionCamera("Barrhaven")!.zoom).toBeGreaterThan(regionCamera("Ottawa")!.zoom);
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(regionCamera("  bArRhAvEn  ")).toEqual(regionCamera("Barrhaven"));
  });

  it("returns null for an unknown place and for empty input", () => {
    expect(regionCamera("Nowhere-On-Sea")).toBeNull();
    expect(regionCamera("   ")).toBeNull();
    expect(regionCamera("")).toBeNull();
  });

  it("every quick-pick market resolves (the list and the resolver can't drift apart)", () => {
    for (const m of QUICK_PICK_MARKETS) {
      expect(regionCamera(m.name), `${m.name} must resolve`).not.toBeNull();
    }
  });
});

describe("regionMapHref", () => {
  it("emits a CAMERA link — no ?city=, which would re-pin the terminal", () => {
    const href = regionMapHref("Barrhaven");
    expect(href).toContain("lat=");
    expect(href).toContain("lng=");
    expect(href).toContain("z=");
    expect(href).not.toContain("city=");
  });

  it("falls back to the place filter only when the region has no camera", () => {
    expect(regionMapHref("Nowhere-On-Sea")).toBe("/properties?city=Nowhere-On-Sea");
  });

  it("URL-encodes the fallback place name", () => {
    expect(regionMapHref("St. Catharines X")).toBe("/properties?city=St.%20Catharines%20X");
  });
});
