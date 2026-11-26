/**
 * Nearest licensed child care assignment for listing enrichment (ETL, Node-only).
 *
 * Loads two committed datasets and, for a listing [lat, lng], finds three straight-line
 * distances:
 *   - NearestChildCareKm  — nearest centre for children under school age, from BOTH files:
 *                           Toronto centres with any infant, toddler or preschool space
 *                           (data/toronto-child-care.json, City of Toronto) and the Ontario
 *                           ministry centres with a full-day, half-day or extended-hours
 *                           program (data/ontario-child-care.json, outside Toronto,
 *                           postal-code locations)
 *   - NearestInfantCareKm — nearest Toronto centre with infant (0-18 months) spaces
 *   - NearestCwelccKm     — nearest Toronto centre in the $10-a-day (CWELCC) program
 * The last two stay TORONTO ONLY: the Ontario list has no spaces by age and no $10-a-day
 * flag, so a home outside Toronto gets the sentinel for them.
 *
 * Deterministic hardcoded math — no AI (CLAUDE.md §4). Mirrors nearestAmenities: a large
 * "none nearby" sentinel (NO_CHILD_CARE_KM = 99) rather than 0, because the map filter is a
 * `NearestInfantCareKm:<=X` predicate and a 0 fallback would falsely match homes with no
 * centre near them. MAX_CHILD_CARE_KM (5 km) keeps a distance to a far centre (e.g. a
 * Mississauga home and the nearest Toronto infant room) from reading as local.
 *
 * Node-only: reads the datasets via fs on first call. Do NOT import from a browser bundle
 * (the map fetches /api/childcare/centres instead).
 */
import * as fs from 'fs';
import * as path from 'path';
import { haversineKm, type ChildCareCentre, type ChildCareFile } from './torontoChildCare';
import type { OntarioChildCareCentre, OntarioChildCareFile } from './ontarioChildCare';

export interface ChildCareAssignment {
  NearestChildCareKm: number;
  NearestInfantCareKm: number;
  NearestCwelccKm: number;
}

/** Beyond this radius a listing gets the sentinel. */
export const MAX_CHILD_CARE_KM = 5;
/** Sentinel for "no centre within MAX_CHILD_CARE_KM" or an invalid location. */
export const NO_CHILD_CARE_KM = 99;
// Coarse pre-filter in degrees: 0.06° lat ≈ 6.7 km, 0.08° lng ≈ 6.4 km at 43.7°N — both
// wider than MAX_CHILD_CARE_KM, so no in-range centre is skipped.
const PREFILTER_LAT = 0.06;
const PREFILTER_LNG = 0.08;
// Ontario reaches 56.9°N, where 1° lng ≈ 61 km: 0.09° ≈ 5.5 km there, wider still further south.
const PREFILTER_LNG_ONTARIO = 0.09;

let CENTRES: ChildCareCentre[] | null = null;
let ONTARIO: OntarioChildCareCentre[] | null = null;

const readData = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', name), 'utf-8')) as T;

function loadCentres(): ChildCareCentre[] {
  if (!CENTRES) CENTRES = readData<ChildCareFile>('toronto-child-care.json').centres;
  return CENTRES;
}

function loadOntario(): OntarioChildCareCentre[] {
  if (!ONTARIO) ONTARIO = readData<OntarioChildCareFile>('ontario-child-care.json').centres;
  return ONTARIO;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const EMPTY: ChildCareAssignment = {
  NearestChildCareKm: NO_CHILD_CARE_KM,
  NearestInfantCareKm: NO_CHILD_CARE_KM,
  NearestCwelccKm: NO_CHILD_CARE_KM,
};

/**
 * Assign the three nearest-child-care distances to a listing location. `centres` (Toronto)
 * and `ontario` are injectable for unit tests; production reads the committed datasets.
 * The Ontario file already holds only centres for children under school age.
 */
export function assignChildCare(
  location: [number, number] | null | undefined,
  centres?: ChildCareCentre[],
  ontario?: OntarioChildCareCentre[]
): ChildCareAssignment {
  if (!location || !Number.isFinite(location[0]) || !Number.isFinite(location[1])) {
    return { ...EMPTY };
  }
  const [lat, lng] = location;
  const list = centres ?? loadCentres();

  let anyKm = Infinity;
  let infantKm = Infinity;
  let cwelccKm = Infinity;
  for (const c of list) {
    if (Math.abs(c.lat - lat) > PREFILTER_LAT || Math.abs(c.lng - lng) > PREFILTER_LNG) continue;
    const young = c.infant > 0 || c.toddler > 0 || c.preschool > 0;
    // Every filter is for children under school age: a centre with only kindergarten or
    // school-age spaces counts for none of them, even when it is in the $10-a-day program.
    if (!young) continue;
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d < anyKm) anyKm = d;
    if (c.infant > 0 && d < infantKm) infantKm = d;
    if (c.cwelcc && d < cwelccKm) cwelccKm = d;
  }
  for (const c of ontario ?? loadOntario()) {
    if (Math.abs(c.lat - lat) > PREFILTER_LAT || Math.abs(c.lng - lng) > PREFILTER_LNG_ONTARIO) continue;
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d < anyKm) anyKm = d;
  }

  const out = (d: number) => (d <= MAX_CHILD_CARE_KM ? r2(d) : NO_CHILD_CARE_KM);
  return {
    NearestChildCareKm: out(anyKm),
    NearestInfantCareKm: out(infantKm),
    NearestCwelccKm: out(cwelccKm),
  };
}

/** City of Toronto bounding box — the backfill reports its counts inside and outside it. */
export const TORONTO_BBOX = { minLat: 43.58, maxLat: 43.86, minLng: -79.64, maxLng: -79.11 } as const;

export function inTorontoBbox(location: [number, number] | null | undefined): boolean {
  if (!location || !Number.isFinite(location[0]) || !Number.isFinite(location[1])) return false;
  const [lat, lng] = location;
  return (
    lat >= TORONTO_BBOX.minLat && lat <= TORONTO_BBOX.maxLat && lng >= TORONTO_BBOX.minLng && lng <= TORONTO_BBOX.maxLng
  );
}

/** Ontario bounding box — the backfill writes the fields for every doc inside it. */
export const ONTARIO_BBOX = { minLat: 41.6, maxLat: 56.9, minLng: -95.2, maxLng: -74.3 } as const;

export function inOntarioBbox(location: [number, number] | null | undefined): boolean {
  if (!location || !Number.isFinite(location[0]) || !Number.isFinite(location[1])) return false;
  const [lat, lng] = location;
  return (
    lat >= ONTARIO_BBOX.minLat && lat <= ONTARIO_BBOX.maxLat && lng >= ONTARIO_BBOX.minLng && lng <= ONTARIO_BBOX.maxLng
  );
}
