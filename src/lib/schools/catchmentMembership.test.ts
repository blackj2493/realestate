import { describe, expect, it } from "vitest";
import {
  buildCatchmentIndex,
  catchmentToken,
  catchmentTokensFor,
  polygonsFromGeoJson,
  type CatchmentZone,
} from "./catchmentMembership";

/** A closed square ring, given its south-west corner and side length in degrees. */
const square = (lng: number, lat: number, side: number): number[][] => [
  [lng, lat],
  [lng + side, lat],
  [lng + side, lat + side],
  [lng, lat + side],
  [lng, lat],
];

const zone = (schoolId: string, program: CatchmentZone["program"], polygons: number[][][][]): CatchmentZone => ({
  schoolId,
  program,
  polygons,
});

describe("catchmentToken", () => {
  it("keys on the school and the program, nothing else", () => {
    expect(catchmentToken("B67059-785563", "french_immersion")).toBe("B67059-785563|french_immersion");
    expect(catchmentToken("B67059-785563", "regular")).toBe("B67059-785563|regular");
  });
});

describe("catchmentTokensFor", () => {
  const regular = zone("SCHOOL-A", "regular", [[square(-79.5, 43.7, 0.1)]]);
  const immersion = zone("SCHOOL-B", "french_immersion", [[square(-79.6, 43.6, 0.4)]]);
  const index = buildCatchmentIndex([regular, immersion]);

  it("returns the zones that contain the point", () => {
    // Inside both: the immersion zone overlaps the regular one it draws from.
    expect(catchmentTokensFor(43.75, -79.45, index)).toEqual([
      "SCHOOL-A|regular",
      "SCHOOL-B|french_immersion",
    ]);
  });

  it("returns only the larger zone where the smaller does not reach", () => {
    // The case that started this: inside the immersion zone, outside the regular one.
    expect(catchmentTokensFor(43.65, -79.55, index)).toEqual(["SCHOOL-B|french_immersion"]);
  });

  it("returns nothing outside every zone", () => {
    expect(catchmentTokensFor(44.5, -80.5, index)).toEqual([]);
  });

  it("is sorted, so a listing's value does not churn between index builds", () => {
    const a = catchmentTokensFor(43.75, -79.45, index);
    const b = catchmentTokensFor(43.75, -79.45, buildCatchmentIndex([immersion, regular]));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(a);
  });

  it("ignores a point with no usable coordinates", () => {
    for (const [lat, lng] of [[NaN, -79.45], [43.75, NaN], [Infinity, 0]]) {
      expect(catchmentTokensFor(lat, lng, index)).toEqual([]);
    }
  });
});

describe("multi-part zones", () => {
  // 194 of 2,569 (school, program) pairs own more than one polygon — a TDSB catchment is
  // routinely several detached pieces. A point in ANY piece is in the zone.
  const split = zone("SCHOOL-C", "regular", [
    [square(-79.5, 43.7, 0.05)],
    [square(-79.2, 43.7, 0.05)],
  ]);
  const index = buildCatchmentIndex([split]);

  it("matches the first piece", () => {
    expect(catchmentTokensFor(43.72, -79.48, index)).toEqual(["SCHOOL-C|regular"]);
  });

  it("matches the second piece", () => {
    expect(catchmentTokensFor(43.72, -79.18, index)).toEqual(["SCHOOL-C|regular"]);
  });

  it("does not match the gap between them", () => {
    // The whole reason each piece keeps its own bbox instead of being merged.
    expect(catchmentTokensFor(43.72, -79.35, index)).toEqual([]);
  });

  it("reports the token once, not once per piece", () => {
    const overlapping = buildCatchmentIndex([
      zone("SCHOOL-D", "regular", [[square(-79.5, 43.7, 0.1)], [square(-79.45, 43.75, 0.1)]]),
    ]);
    expect(catchmentTokensFor(43.78, -79.42, overlapping)).toEqual(["SCHOOL-D|regular"]);
  });
});

describe("holes", () => {
  // A donut: outer ring with an inner ring cut out of it.
  const donut = zone("SCHOOL-E", "regular", [
    [square(-79.5, 43.7, 0.2), square(-79.45, 43.75, 0.05)],
  ]);
  const index = buildCatchmentIndex([donut]);

  it("matches the ring", () => {
    expect(catchmentTokensFor(43.72, -79.48, index)).toEqual(["SCHOOL-E|regular"]);
  });

  it("does not match inside the hole", () => {
    expect(catchmentTokensFor(43.77, -79.43, index)).toEqual([]);
  });
});

describe("buildCatchmentIndex", () => {
  it("skips a zone with no school id — it can never be the target of the filter", () => {
    // 207 of 3,296 rows carry no school_id. They still draw on the map; they just cannot
    // be selected, so carrying them into listing membership would be dead weight.
    const index = buildCatchmentIndex([zone("", "regular", [[square(-79.5, 43.7, 0.1)]])]);
    expect(index.zones).toHaveLength(0);
    expect(catchmentTokensFor(43.75, -79.45, index)).toEqual([]);
  });

  it("skips empty geometry rather than indexing an infinite bbox", () => {
    const index = buildCatchmentIndex([
      zone("SCHOOL-F", "regular", []),
      zone("SCHOOL-G", "regular", [[]]),
    ]);
    expect(index.zones).toHaveLength(0);
  });

  it("buckets a zone into every cell its bbox covers", () => {
    // A zone far larger than one grid cell must be findable from anywhere inside it.
    const big = zone("SCHOOL-H", "french_immersion", [[square(-79.8, 43.5, 0.5)]]);
    const index = buildCatchmentIndex([big]);
    for (const [lat, lng] of [[43.55, -79.75], [43.75, -79.55], [43.95, -79.35]]) {
      expect(catchmentTokensFor(lat, lng, index), `${lat},${lng}`).toEqual([
        "SCHOOL-H|french_immersion",
      ]);
    }
  });
});

describe("polygonsFromGeoJson", () => {
  it("accepts a Polygon", () => {
    const g = { type: "Polygon", coordinates: [square(-79.5, 43.7, 0.1)] };
    expect(polygonsFromGeoJson(g)).toEqual([g.coordinates]);
  });

  it("accepts a MultiPolygon", () => {
    const g = { type: "MultiPolygon", coordinates: [[square(-79.5, 43.7, 0.1)]] };
    expect(polygonsFromGeoJson(g)).toEqual(g.coordinates);
  });

  it("returns nothing for a geometry it cannot read", () => {
    // A zone we cannot parse is a zone we do not claim membership of.
    for (const g of [
      null,
      undefined,
      "Polygon",
      { type: "LineString", coordinates: [[0, 0], [1, 1]] },
      { type: "GeometryCollection", geometries: [] },
      { type: "Polygon" },
    ]) {
      expect(polygonsFromGeoJson(g), JSON.stringify(g)).toEqual([]);
    }
  });
});
