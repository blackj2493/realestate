import { describe, it, expect } from "vitest";
import { areaFilter, regionArea, COMMUNITY_ALIASES } from "./area";

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
