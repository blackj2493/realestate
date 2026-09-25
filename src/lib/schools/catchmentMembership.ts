/**
 * Which school catchments contain a point — the membership behind the "school" filter.
 *
 * WHY THIS EXISTS. "Near a specific school" has always filtered listings by
 * `NearbySchools:=<id>`, an array of every school within 2.5 km stamped onto each listing
 * at index time. That predates catchment boundaries by a year, and nothing in the listing
 * index has ever been catchment-derived — so the filter answers a proximity question while
 * the map draws an attendance boundary, and the two disagree in public.
 *
 * Reported 2026-09-24: 27 Coach Liteway sits INSIDE St Cyril's French Immersion catchment
 * and 2.75 km from the school, so a search for St Cyril excluded it by 250 m. That zone is
 * 57.6 km²; the circle is 19.6 km², centred on the school, and a French Immersion zone is
 * neither centred nor disc-shaped — it is the union of the regular catchments that feed it.
 *
 * So membership is computed the only way it can be: point-in-polygon against the real
 * boundaries, at index time, into a field the query can filter on.
 *
 * THE TOKEN IS `<school_id>|<program>`. A school is chosen by id, and the program is the
 * axis the reader already picked in the panel; panel and grade band are properties OF that
 * school rather than choices on top of it. 194 of 2,569 (school, program) pairs own more
 * than one polygon — TDSB catchments are routinely several detached pieces — and a point
 * inside ANY piece is inside the zone, which falls out of the token being shared.
 *
 * Pure and browser-safe: no fs, no network. The caller supplies the zones.
 */

import type { SchoolProgram } from "@/lib/stores/commandCenterStore";

/** One school's boundary for one program, as one or more rings. */
export interface CatchmentZone {
  /** Matches `id` in data/ontario-schools.json — 93.7% of catchment rows carry one. */
  schoolId: string;
  program: SchoolProgram;
  /**
   * MultiPolygon coordinates: [polygon][ring][point][lng, lat]. Ring 0 of each polygon is
   * the outer boundary; any further rings are holes.
   */
  polygons: number[][][][];
}

/** The value stored on a listing and matched by the filter. */
export function catchmentToken(schoolId: string, program: SchoolProgram): string {
  return `${schoolId}|${program}`;
}

/**
 * Grid cell size in degrees for the bbox index.
 *
 * ~0.05° is roughly 5.5 km north-south. Small enough that a lookup tests a handful of
 * candidates rather than all 3,296 zones, large enough that a 57 km² immersion zone spans
 * tens of cells rather than thousands. The index is built once per run and queried ~102,000
 * times, so the asymmetry is deliberate: pay at build, save at lookup.
 */
export const GRID_DEG = 0.05;

interface IndexedZone {
  token: string;
  polygons: number[][][][];
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
}

export interface CatchmentIndex {
  zones: IndexedZone[];
  /** cell key → indices into `zones` */
  cells: Map<string, number[]>;
}

const cellKey = (lng: number, lat: number): string =>
  `${Math.floor(lng / GRID_DEG)}:${Math.floor(lat / GRID_DEG)}`;

function bboxOf(polygons: number[][][][]): [number, number, number, number] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const poly of polygons) {
    for (const pt of poly[0] ?? []) {
      if (pt[0] < minLng) minLng = pt[0];
      if (pt[0] > maxLng) maxLng = pt[0];
      if (pt[1] < minLat) minLat = pt[1];
      if (pt[1] > maxLat) maxLat = pt[1];
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Bucket every zone into the grid cells its bbox covers.
 *
 * Zones sharing a token are kept as SEPARATE entries rather than merged. Merging would mean
 * concatenating unrelated polygon lists and recomputing a bbox that spans the gap between
 * two detached pieces — a bbox that says "candidate" across a lot of ground where the answer
 * is no. Separate entries keep each bbox tight; the dedupe happens on the token at the end.
 */
export function buildCatchmentIndex(zones: readonly CatchmentZone[]): CatchmentIndex {
  const out: CatchmentIndex = { zones: [], cells: new Map() };
  for (const z of zones) {
    if (!z.schoolId || !z.polygons?.length) continue;
    const bbox = bboxOf(z.polygons);
    if (!Number.isFinite(bbox[0])) continue; // empty geometry
    const i = out.zones.length;
    out.zones.push({ token: catchmentToken(z.schoolId, z.program), polygons: z.polygons, bbox });

    const x0 = Math.floor(bbox[0] / GRID_DEG), x1 = Math.floor(bbox[2] / GRID_DEG);
    const y0 = Math.floor(bbox[1] / GRID_DEG), y1 = Math.floor(bbox[3] / GRID_DEG);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = `${x}:${y}`;
        const bucket = out.cells.get(k);
        if (bucket) bucket.push(i);
        else out.cells.set(k, [i]);
      }
    }
  }
  return out;
}

/**
 * Ray casting, counting crossings of a half-line to the east.
 *
 * A point exactly on an edge is not meaningfully inside or outside — a listing on a boundary
 * street belongs to whichever side the board says, which is not information we hold. Ray
 * casting resolves it consistently rather than correctly, and that is the honest limit here.
 */
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and not inside any hole. */
function pointInPolygon(lng: number, lat: number, poly: number[][][]): boolean {
  if (!poly.length || !pointInRing(lng, lat, poly[0])) return false;
  for (let r = 1; r < poly.length; r++) if (pointInRing(lng, lat, poly[r])) return false;
  return true;
}

/**
 * The catchment tokens containing this point, sorted and de-duplicated.
 *
 * Sorted so the value a listing carries is stable between runs: an unsorted array would
 * re-order on every index build and make every document look changed to the diff that
 * decides what to re-upload.
 */
export function catchmentTokensFor(
  lat: number,
  lng: number,
  index: CatchmentIndex
): string[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const candidates = index.cells.get(cellKey(lng, lat));
  if (!candidates?.length) return [];

  const hits = new Set<string>();
  for (const i of candidates) {
    const z = index.zones[i];
    if (hits.has(z.token)) continue; // another piece of the same zone already matched
    if (lng < z.bbox[0] || lng > z.bbox[2] || lat < z.bbox[1] || lat > z.bbox[3]) continue;
    for (const poly of z.polygons) {
      if (pointInPolygon(lng, lat, poly)) {
        hits.add(z.token);
        break;
      }
    }
  }
  return [...hits].sort();
}

/**
 * Normalise a GeoJSON geometry to the MultiPolygon coordinate shape this module expects.
 *
 * Returns an empty array for anything that is not a polygon — a board occasionally publishes
 * a GeometryCollection or a stray LineString, and a zone we cannot read is a zone we do not
 * claim membership of, which is the safe direction.
 */
export function polygonsFromGeoJson(geom: unknown): number[][][][] {
  if (!geom || typeof geom !== "object") return [];
  const g = geom as { type?: string; coordinates?: unknown };
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
    return [g.coordinates as number[][][]];
  }
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    return g.coordinates as number[][][][];
  }
  return [];
}
