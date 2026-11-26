import { describe, it, expect } from "vitest";
import {
  cityTitleCase,
  hasOntarioCentreWithin,
  nearbyOntarioChildCare,
  normalisePostal,
  parseProgramOptions,
  type OntarioChildCareCentre,
  type OntarioChildCareFile,
} from "./ontarioChildCare";
import { buildOntarioCentres, monthlyKey, pickLatestMonthlyResource, snapshotIso } from "./ontarioBuild";
import real from "../../../data/ontario-child-care.json";

const lat = 45.42, lng = -75.69; // Ottawa
const centre = (id: string, la: number, ln: number, o: Partial<OntarioChildCareCentre> = {}): OntarioChildCareCentre => ({
  id, name: `C${id}`, lat: la, lng: ln, city: "Ottawa", fullDay: true, ...o,
});
const file = (centres: OntarioChildCareCentre[]): OntarioChildCareFile => ({ updated: "2026-10-31", source: "test", centres });

describe("nearbyOntarioChildCare", () => {
  it("counts centres inside the radius, sorted by distance, with the full-day count", () => {
    const r = nearbyOntarioChildCare(
      file([centre("1", lat + 0.005, lng), centre("2", lat + 0.001, lng, { fullDay: false }), centre("3", lat + 0.02, lng)]),
      lat,
      lng,
    );
    expect(r.radiusKm).toBe(1);
    expect(r.count).toBe(2); // #3 is ~2.2 km away
    expect(r.fullDayCount).toBe(1);
    expect(r.centres.map((c) => c.id)).toEqual(["2", "1"]);
    expect(r.centres[0]).toEqual({ id: "2", name: "C2", city: "Ottawa", fullDay: false, distanceKm: 0.11 });
    expect(r.updated).toBe("2026-10-31");
  });

  it("takes a radius", () => {
    const f = file([centre("1", lat + 0.02, lng)]);
    expect(nearbyOntarioChildCare(f, lat, lng).count).toBe(0);
    expect(nearbyOntarioChildCare(f, lat, lng, 3).count).toBe(1);
  });

  it("works on the committed file for downtown Ottawa", () => {
    const r = nearbyOntarioChildCare(real as OntarioChildCareFile, lat, lng);
    expect(r.count).toBeGreaterThan(0);
    expect(r.fullDayCount).toBeLessThanOrEqual(r.count);
  });
});

describe("hasOntarioCentreWithin", () => {
  it("is true within 5 km and false beyond", () => {
    expect(hasOntarioCentreWithin(file([centre("1", lat + 0.04, lng)]), lat, lng)).toBe(true); // ~4.4 km
    expect(hasOntarioCentreWithin(file([centre("1", lat + 0.05, lng)]), lat, lng)).toBe(false); // ~5.6 km
    expect(hasOntarioCentreWithin(file([]), lat, lng)).toBe(false);
  });
});

describe("parseProgramOptions", () => {
  it("keeps full day, half day and extended hours; drops before/after school only", () => {
    expect(parseProgramOptions("Full Day(6 hours or more in a day), Before school, After school")).toEqual({ keep: true, fullDay: true });
    expect(parseProgramOptions("Half day(Less than 6 hours in a day)")).toEqual({ keep: true, fullDay: false });
    expect(parseProgramOptions("Extended hours(more than 12 hours), After school")).toEqual({ keep: true, fullDay: true });
    expect(parseProgramOptions("Before school, After school")).toEqual({ keep: false, fullDay: false });
    expect(parseProgramOptions("")).toEqual({ keep: false, fullDay: false });
  });
});

describe("cityTitleCase / normalisePostal", () => {
  it("title-cases all-caps and keeps mixed case", () => {
    expect(cityTitleCase("THUNDER BAY")).toBe("Thunder Bay");
    expect(cityTitleCase(" st. catharines ")).toBe("St. Catharines");
    expect(cityTitleCase("Niagara-on-the-Lake")).toBe("Niagara-on-the-Lake");
  });
  it("removes spaces and upper-cases", () => {
    expect(normalisePostal(" k1a 0b1 ")).toBe("K1A0B1");
  });
});

describe("pickLatestMonthlyResource", () => {
  it("picks the newest monthly XLSX by its name, ignoring the dictionary and unnamed rows", () => {
    const r = pickLatestMonthlyResource([
      { name: "Data dictionary", format: "XLSX", url: "d.xlsx", created: "2019-12-31" },
      { name: "", format: "XLSX", url: "x", created: "2023-08-17" },
      // Older month, re-uploaded later: its last_modified is newer but the month is older.
      { name: "September 2026", format: "XLSX", url: "sep.xlsx", last_modified: "2026-11-20T00:00:00" },
      { name: "October 2026", format: "XLSX", url: "oct.xlsx", last_modified: "2026-11-10T20:25:38" },
      { name: "November 2026", format: "CSV", url: "nov.csv", last_modified: "2026-12-10" },
    ]);
    expect(r.url).toBe("oct.xlsx");
  });
  it("throws when there is no monthly resource", () => {
    expect(() => pickLatestMonthlyResource([{ name: "Data dictionary", format: "XLSX", url: "d" }])).toThrow();
  });
  it("parses month names", () => {
    expect(monthlyKey("October 2026")).toBe(202610);
    expect(monthlyKey("Data dictionary")).toBeNull();
    expect(monthlyKey("Octobre 2026")).toBeNull();
  });
});

describe("snapshotIso", () => {
  it("reads an Excel serial, a Date and an ISO string", () => {
    expect(snapshotIso(46326)).toBe("2026-10-31");
    expect(snapshotIso(new Date("2026-10-31T00:00:00Z"))).toBe("2026-10-31");
    expect(snapshotIso("2026-10-31")).toBe("2026-10-31");
    expect(snapshotIso("")).toBeNull();
    expect(snapshotIso(undefined)).toBeNull();
  });
});

describe("buildOntarioCentres", () => {
  const row = (o: Record<string, string>) => ({
    "Licence Status": "Active",
    "Program Type Desc": "Child Care Centre",
    "CMSM DSSAB Name": "City of Ottawa",
    "Child Care Site Name": "LITTLE STARS",
    "Licence Number": "0001",
    "Program Option": "Full Day(6 hours or more in a day)",
    City: "OTTAWA",
    "Postal Code": "K1A 0B1",
    ...o,
  });
  const postal = new Map([["K1A0B1", { lat: 45.4215123, lng: -75.6971987 }]]);

  it("keeps active centres outside Toronto with a pre-school program, located by postal code", () => {
    const { centres, stats } = buildOntarioCentres(
      [
        row({}),
        row({ "Licence Number": "0002", "Program Option": "Half day(Less than 6 hours in a day)" }),
        row({ "Licence Number": "0003", "Program Option": "Before school, After school" }),
        row({ "Licence Number": "0004", "Licence Status": "Inactive" }),
        row({ "Licence Number": "0005", "Program Type Desc": "Home Child Care Agency" }),
        row({ "Licence Number": "0006", "CMSM DSSAB Name": "City of Toronto" }),
        row({ "Licence Number": "0007", "Postal Code": "X0X 0X0" }),
        row({}), // duplicate licence
      ],
      postal,
    );
    expect(centres).toEqual([
      { id: "0001", name: "Little Stars", lat: 45.42151, lng: -75.6972, city: "Ottawa", fullDay: true },
      { id: "0002", name: "Little Stars", lat: 45.42151, lng: -75.6972, city: "Ottawa", fullDay: false },
    ]);
    expect(stats).toMatchObject({ active: 7, agencies: 1, toronto: 1, schoolAgeOnly: 1, candidates: 3, unmatched: 1, kept: 2 });
    expect(stats.matchRate).toBeCloseTo(2 / 3);
  });
});

describe("committed data/ontario-child-care.json", () => {
  it("has no Toronto centres and enough centres", () => {
    const f = real as OntarioChildCareFile;
    expect(f.centres.length).toBeGreaterThan(2500);
    expect(f.centres.some((c) => c.city === "Toronto")).toBe(false);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(f.updated)).toBe(true);
  });
});
