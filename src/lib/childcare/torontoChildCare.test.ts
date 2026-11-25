import { describe, it, expect } from "vitest";
import { displayName, inPolygons, nearbyChildCare, type ChildCareCentre, type ChildCareFile } from "./torontoChildCare";
import real from "../../../data/toronto-child-care.json";

const square: [number, number][][][] = [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]];
const holed: [number, number][][][] = [[square[0][0], [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]]]];

const centre = (id: number, lat: number, lng: number, o: Partial<ChildCareCentre> = {}): ChildCareCentre => ({
  id, name: `C${id}`, lat, lng, infant: 0, toddler: 10, preschool: 16, kindergarten: 0, schoolAge: 0, cwelcc: true, ...o,
});

function file(centres: ChildCareCentre[]): ChildCareFile {
  return {
    updated: "2026-11-25",
    source: "test",
    centres,
    neighbourhoods: [
      { name: "Here", children: 100, centres: 0, infant: 0, youngSpaces: 50, per100: 50, polygons: [[[[-79.4, 43.6], [-79.3, 43.6], [-79.3, 43.7], [-79.4, 43.7], [-79.4, 43.6]]]] },
      { name: "Richer", children: 100, centres: 0, infant: 0, youngSpaces: 80, per100: 80, polygons: square },
    ],
    city: { children: 200, youngSpaces: 130, infant: 0, per100: 65, infantPer100: 0 },
  };
}

describe("inPolygons", () => {
  it("is inside the outer ring and outside a hole", () => {
    expect(inPolygons(0.2, 0.2, square)).toBe(true);
    expect(inPolygons(1.5, 0.5, square)).toBe(false);
    expect(inPolygons(0.5, 0.5, holed)).toBe(false);
    expect(inPolygons(0.2, 0.2, holed)).toBe(true);
  });
});

describe("displayName", () => {
  it("title-cases an all-caps name and keeps a mixed-case one", () => {
    expect(displayName("LE PETIT CHAPERON ROUGE - COXWELL")).toBe("Le Petit Chaperon Rouge - Coxwell");
    expect(displayName("Muppets Children's Centre 314")).toBe("Muppets Children's Centre 314");
  });
});

describe("nearbyChildCare", () => {
  const lat = 43.65, lng = -79.35;
  it("counts only centres inside the radius and sorts by distance", () => {
    const r = nearbyChildCare(file([centre(1, lat + 0.005, lng), centre(2, lat + 0.001, lng, { infant: 10, cwelcc: false }), centre(3, lat + 0.02, lng)]), lat, lng);
    expect(r.count).toBe(2); // #3 is ~2.2 km away
    expect(r.centres.map((c) => c.id)).toEqual([2, 1]);
    expect(r.infantSpaces).toBe(10);
    expect(r.centresWithInfant).toBe(1);
    expect(r.cwelccCount).toBe(1);
  });

  it("finds infant care beyond the radius when none is inside it", () => {
    const r = nearbyChildCare(file([centre(1, lat + 0.001, lng), centre(2, lat + 0.02, lng, { infant: 6 })]), lat, lng);
    expect(r.infantSpaces).toBe(0);
    expect(r.nearestInfant?.name).toBe("C2");
    expect(r.nearestInfant!.distanceKm).toBeGreaterThan(2);
  });

  it("places the home in its neighbourhood and ranks it", () => {
    const r = nearbyChildCare(file([]), lat, lng);
    expect(r.neighbourhood).toEqual({ name: "Here", per100: 50, rankFromTop: 2, of: 2 });
    expect(r.count).toBe(0);
  });

  it("returns no neighbourhood outside the city", () => {
    expect(nearbyChildCare(file([]), 45.4, -75.7).neighbourhood).toBeNull();
  });
});

describe("the committed data file", () => {
  const f = real as unknown as ChildCareFile;
  it("covers all 158 neighbourhoods, each with children and a rate", () => {
    expect(f.neighbourhoods).toHaveLength(158);
    for (const n of f.neighbourhoods) {
      expect(n.children).toBeGreaterThan(0);
      expect(n.per100).toBeCloseTo((100 * n.youngSpaces) / n.children, 0);
    }
  });

  it("has every centre inside Toronto's bounding box with sane spaces", () => {
    expect(f.centres.length).toBeGreaterThan(900);
    for (const c of f.centres) {
      expect(c.lat).toBeGreaterThan(43.55);
      expect(c.lat).toBeLessThan(43.86);
      expect(c.lng).toBeGreaterThan(-79.65);
      expect(c.lng).toBeLessThan(-79.1);
      expect(c.infant + c.toddler + c.preschool + c.kindergarten + c.schoolAge).toBeGreaterThan(0);
    }
  });

  it("places a known East York home in East End-Danforth", () => {
    const r = nearbyChildCare(f, 43.6831, -79.3111); // 97 Oakcrest Ave
    expect(r.neighbourhood?.name).toBe("East End-Danforth");
    expect(r.count).toBeGreaterThan(10);
  });
});
