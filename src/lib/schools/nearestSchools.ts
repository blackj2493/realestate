/**
 * Nearest-rated-school assignment for listing enrichment (ETL, Node-only).
 *
 * Loads the committed data/ontario-schools.json (built by
 * scripts/admin/build-schools-dataset.ts from OGL-Ontario EQAO open data) and, for a
 * given listing [lat, lng], finds the nearest RATED school in each of the four panels
 * (public/catholic × elementary/secondary), plus "either-system" rollups and the set of
 * nearby school ids for target-school filtering.
 *
 * Deterministic hardcoded math (haversine) — no AI, compliant with CLAUDE.md §4. All
 * outputs carry aggressive fallbacks (0 / '' / []) per CLAUDE.md §6 so every declared
 * Typesense key is always present.
 *
 * Node-only: reads the dataset via fs at module load. Do NOT import from a browser
 * bundle (the SchoolFilter autocomplete imports the JSON directly instead).
 */
import * as fs from 'fs';
import * as path from 'path';

export interface SchoolRecord {
  id: string;
  name: string;
  level: 'elementary' | 'secondary';
  system: 'public' | 'catholic';
  language: string;
  lat: number;
  lng: number;
  score: number | null;
  address: string;
}

export interface SchoolAssignment {
  // Per-panel nearest RATED school: score (0–10), name, distance (km).
  ElemPublicScore: number;
  ElemPublicSchool: string;
  ElemPublicDistanceKm: number;
  ElemCatholicScore: number;
  ElemCatholicSchool: string;
  ElemCatholicDistanceKm: number;
  SecPublicScore: number;
  SecPublicSchool: string;
  SecPublicDistanceKm: number;
  SecCatholicScore: number;
  SecCatholicSchool: string;
  SecCatholicDistanceKm: number;
  // "Either-system" rollups for lens + default ranking.
  BestElementaryScore: number;
  BestSecondaryScore: number;
  BestSchoolScoreNearby: number;
  // Ids of all schools within NEARBY_RADIUS_KM (for NearbySchools:=<id> target filter).
  NearbySchools: string[];
}

// Nearest rated school per panel must be within this radius to count.
const MAX_PANEL_KM = 8;
// A school is "nearby" (target-filterable) within this tighter radius.
const NEARBY_RADIUS_KM = 2.5;
// Coarse pre-filter: skip schools whose lat/lng differ by more than this (~14 km).
const PREFILTER_DEG = 0.13;

let SCHOOLS: SchoolRecord[] | null = null;

function loadSchools(): SchoolRecord[] {
  if (SCHOOLS) return SCHOOLS;
  const file = path.join(process.cwd(), 'data', 'ontario-schools.json');
  SCHOOLS = JSON.parse(fs.readFileSync(file, 'utf-8')) as SchoolRecord[];
  return SCHOOLS;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const EMPTY: SchoolAssignment = {
  ElemPublicScore: 0, ElemPublicSchool: '', ElemPublicDistanceKm: 0,
  ElemCatholicScore: 0, ElemCatholicSchool: '', ElemCatholicDistanceKm: 0,
  SecPublicScore: 0, SecPublicSchool: '', SecPublicDistanceKm: 0,
  SecCatholicScore: 0, SecCatholicSchool: '', SecCatholicDistanceKm: 0,
  BestElementaryScore: 0, BestSecondaryScore: 0, BestSchoolScoreNearby: 0,
  NearbySchools: [],
};

/**
 * Assign nearest rated schools to a listing location. Returns all-zero fallbacks for an
 * invalid/missing coordinate (e.g. the Toronto geocoding fallback is still a valid point,
 * so it will resolve to downtown schools — acceptable).
 */
export function assignSchools(location: [number, number] | null | undefined): SchoolAssignment {
  if (!location || !Number.isFinite(location[0]) || !Number.isFinite(location[1])) {
    return { ...EMPTY };
  }
  const [lat, lng] = location;
  const schools = loadSchools();

  // Per-panel nearest rated school.
  type Best = { score: number; name: string; dist: number };
  const best: Record<string, Best> = {};
  const nearbyIds: string[] = [];

  for (const s of schools) {
    if (Math.abs(s.lat - lat) > PREFILTER_DEG || Math.abs(s.lng - lng) > PREFILTER_DEG) continue;
    const dist = haversineKm(lat, lng, s.lat, s.lng);

    if (dist <= NEARBY_RADIUS_KM) nearbyIds.push(s.id);

    if (s.score === null || dist > MAX_PANEL_KM) continue;
    const panel = `${s.level}/${s.system}`;
    const cur = best[panel];
    if (!cur || dist < cur.dist) best[panel] = { score: s.score, name: s.name, dist };
  }

  const ep = best['elementary/public'];
  const ec = best['elementary/catholic'];
  const sp = best['secondary/public'];
  const sc = best['secondary/catholic'];

  const bestElem = Math.max(ep?.score ?? 0, ec?.score ?? 0);
  const bestSec = Math.max(sp?.score ?? 0, sc?.score ?? 0);

  return {
    ElemPublicScore: r2(ep?.score ?? 0), ElemPublicSchool: ep?.name ?? '', ElemPublicDistanceKm: r2(ep?.dist ?? 0),
    ElemCatholicScore: r2(ec?.score ?? 0), ElemCatholicSchool: ec?.name ?? '', ElemCatholicDistanceKm: r2(ec?.dist ?? 0),
    SecPublicScore: r2(sp?.score ?? 0), SecPublicSchool: sp?.name ?? '', SecPublicDistanceKm: r2(sp?.dist ?? 0),
    SecCatholicScore: r2(sc?.score ?? 0), SecCatholicSchool: sc?.name ?? '', SecCatholicDistanceKm: r2(sc?.dist ?? 0),
    BestElementaryScore: r2(bestElem),
    BestSecondaryScore: r2(bestSec),
    BestSchoolScoreNearby: r2(Math.max(bestElem, bestSec)),
    NearbySchools: nearbyIds,
  };
}
