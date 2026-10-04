import { describe, it, expect } from "vitest";
import { TORONTO_PARTS, OTTAWA_PARTS, CITY_PARTS, partsOf, partForCity, partNamed } from "./cityParts";
import { CITY_GROUPS, areaFilter, regionCamera, isWholeCityRegion } from "./area";
import { OTTAWA_AREAS } from "./ottawaAreas";

// The grammar the market APIs accept for a region (api/market/*/route.ts). A part name
// that fails it would save fine and then show an empty scorecard.
const REGION_RE = /^[\p{L}\p{N}\s\-'.]{1,60}$/u;

describe("Toronto parts", () => {
  it("cover every Toronto district exactly once (TREB has no C05)", () => {
    const members = TORONTO_PARTS.flatMap((p) => p.members);
    const districts = CITY_GROUPS.Toronto.filter((c) => c !== "Toronto" && c !== "Toronto C05");
    expect([...members].sort()).toEqual([...districts].sort());
    expect(new Set(members).size).toBe(members.length);
  });

  it("are names the market APIs accept", () => {
    for (const p of TORONTO_PARTS) expect(p.name).toMatch(REGION_RE);
  });

  it("expand to their districts wherever a group expands", () => {
    for (const p of TORONTO_PARTS) {
      expect(CITY_GROUPS[p.name]).toEqual([...p.members]);
      expect(areaFilter({ kind: "region", name: p.name })).toBe(
        `City:=[${p.members.map((m) => `\`${m}\``).join(", ")}]`
      );
    }
  });

  it("open the map on the part, and count as a whole-city area", () => {
    for (const p of TORONTO_PARTS) {
      expect(regionCamera(p.name)).toEqual({ lat: p.lat, lng: p.lng, zoom: p.zoom });
      expect(isWholeCityRegion(p.name)).toBe(true);
    }
  });

  it("follow the approved grouping", () => {
    expect(partForCity("Toronto C11")?.name).toBe("East End and East York");
    expect(partForCity("Toronto W04")?.name).toBe("West End and York");
    expect(partForCity("Toronto W05")?.name).toBe("North York");
    expect(partForCity("toronto e05")?.name).toBe("Scarborough");
    expect(partForCity("Mississauga")).toBeNull();
    expect(partNamed("scarborough")?.name).toBe("Scarborough");
  });

  it("are offered for Toronto and Ottawa only", () => {
    expect(partsOf("Toronto")).toBe(TORONTO_PARTS);
    expect(partsOf("Ottawa")).toBe(OTTAWA_PARTS);
    expect(partsOf("Richmond Hill")).toBeNull();
  });
});

describe("Ottawa parts", () => {
  it("cover every Ottawa OREB area exactly once", () => {
    const members = OTTAWA_PARTS.flatMap((p) => p.members);
    expect([...members].sort()).toEqual([...OTTAWA_AREAS].sort());
    expect(new Set(members).size).toBe(members.length);
  });

  it("follow the approved grouping", () => {
    expect(partForCity("Barrhaven")?.name).toBe("Barrhaven and Manotick");
    expect(partForCity("Kanata")?.name).toBe("Kanata and Stittsville");
    expect(partForCity("Overbrook - Castleheights and Area")?.name).toBe("Central Ottawa");
    // Riverside South lives inside this area, which the feed cannot split.
    expect(partForCity("Blossom Park - Airport and Area")?.name).toBe("South Ottawa");
    expect(partForCity("Stittsville - Munster - Richmond")?.name).toBe("Kanata and Stittsville");
  });
});

describe("every city's parts", () => {
  const all = Object.values(CITY_PARTS).flat();

  it("have unique names the market APIs accept", () => {
    for (const p of all) expect(p.name).toMatch(REGION_RE);
    expect(new Set(all.map((p) => p.name.toLowerCase())).size).toBe(all.length);
  });

  it("expand, open the map, and count as a whole-city area", () => {
    for (const p of all) {
      expect(CITY_GROUPS[p.name]).toEqual([...p.members]);
      expect(regionCamera(p.name)).toEqual({ lat: p.lat, lng: p.lng, zoom: p.zoom });
      expect(isWholeCityRegion(p.name)).toBe(true);
    }
  });

  it("leave each parent city followable whole for existing readers", () => {
    expect(CITY_GROUPS.Toronto.length).toBeGreaterThan(30);
    expect(CITY_GROUPS.Ottawa).toEqual(OTTAWA_AREAS);
  });
});
