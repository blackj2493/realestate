/**
 * Ontario licensed child care centres near a point (outside the City of Toronto).
 *
 * Data: data/ontario-child-care.json, built by scripts/data/buildOntarioChildCare.ts from
 * the Ontario Ministry of Education "Licensed child care facilities in Ontario" list
 * (Open Government Licence – Ontario, monthly). Refreshed monthly by
 * refresh-ontario-child-care.yml.
 *
 * A COUNT, NOT CAPACITY. The provincial list has no spaces, no coordinates and no $10-a-day
 * flag, so this file only says where licensed centres are and whether they run a full day.
 * Locations are the centre's postal code point (median ~90 m off on Toronto centres), so
 * every surface that shows them says "approximate".
 *
 * Toronto is NOT in this file: the City of Toronto data (torontoChildCare.ts) is richer and
 * covers it. Centres that run only before/after school are left out, as in Toronto: the
 * tool is for children under school age.
 */
import { haversineKm } from "./torontoChildCare";

export interface OntarioChildCareCentre {
  /** Licence number, as printed by the ministry (may have leading zeros). */
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string;
  /** Runs a full day (6 hours or more) or extended hours. Otherwise half day only. */
  fullDay: boolean;
}

export interface OntarioChildCareFile {
  updated: string; // ISO date of the ministry snapshot
  source: string;
  centres: OntarioChildCareCentre[];
}

export interface NearbyOntarioChildCare {
  radiusKm: number;
  count: number;
  fullDayCount: number;
  centres: { id: string; name: string; city: string; fullDay: boolean; distanceKm: number }[];
  updated: string;
}

/** Beyond this distance a point has no Ontario coverage (the listing card says nothing). */
export const ONTARIO_COVERAGE_KM = 5;

/** Degrees per km, wide enough for Ontario's latitudes (lng degrees shrink to ~60 km at 57°N). */
const inBox = (c: { lat: number; lng: number }, lat: number, lng: number, km: number) =>
  Math.abs(c.lat - lat) <= km / 100 && Math.abs(c.lng - lng) <= km / 55;

export function nearbyOntarioChildCare(
  file: OntarioChildCareFile,
  lat: number,
  lng: number,
  radiusKm = 1,
): NearbyOntarioChildCare {
  const box = radiusKm * 3;
  const inRange: NearbyOntarioChildCare["centres"] = [];
  for (const c of file.centres) {
    if (!inBox(c, lat, lng, box)) continue;
    const d = Math.round(haversineKm(lat, lng, c.lat, c.lng) * 100) / 100;
    if (d <= radiusKm) inRange.push({ id: c.id, name: c.name, city: c.city, fullDay: c.fullDay, distanceKm: d });
  }
  inRange.sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name));
  return {
    radiusKm,
    count: inRange.length,
    fullDayCount: inRange.filter((c) => c.fullDay).length,
    centres: inRange,
    updated: file.updated,
  };
}

/** True when any centre in the file is within `km` straight-line of the point. */
export function hasOntarioCentreWithin(file: OntarioChildCareFile, lat: number, lng: number, km = ONTARIO_COVERAGE_KM): boolean {
  return file.centres.some((c) => inBox(c, lat, lng, km * 1.5) && haversineKm(lat, lng, c.lat, c.lng) <= km);
}

/** "Full Day(6 hours or more in a day), Before school" → the parsed options. */
export function parseProgramOptions(raw: string): { keep: boolean; fullDay: boolean } {
  const opts = String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase());
  const fullDay = opts.some((o) => o.startsWith("full day") || o.startsWith("extended hours"));
  const halfDay = opts.some((o) => o.startsWith("half day"));
  return { keep: fullDay || halfDay, fullDay };
}

/** "TORONTO" / "toronto" → "Toronto"; a mixed-case name ("Niagara-on-the-Lake") is kept. */
export function cityTitleCase(raw: string): string {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-.'])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

/** "M4A 2K7" → "M4A2K7". */
export const normalisePostal = (raw: string) => String(raw ?? "").replace(/\s+/g, "").toUpperCase();
