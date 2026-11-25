/**
 * Nearest licensed child care assignment for listing enrichment (ETL, Node-only).
 *
 * Loads the committed data/toronto-child-care.json (City of Toronto licensed centres, see
 * torontoChildCare.ts) and, for a listing [lat, lng], finds three straight-line distances:
 *   - NearestChildCareKm  — nearest centre with ANY infant, toddler or preschool space
 *   - NearestInfantCareKm — nearest centre with infant (0-18 months) spaces
 *   - NearestCwelccKm     — nearest centre in the $10-a-day (CWELCC) program
 *
 * Deterministic hardcoded math — no AI (CLAUDE.md §4). Mirrors nearestAmenities: a large
 * "none nearby" sentinel (NO_CHILD_CARE_KM = 99) rather than 0, because the map filter is a
 * `NearestInfantCareKm:<=X` predicate and a 0 fallback would falsely match homes with no
 * centre near them.
 *
 * TORONTO ONLY. The dataset covers the City of Toronto, so MAX_CHILD_CARE_KM is short
 * (5 km): a Mississauga or Markham listing gets the sentinel rather than a distance to a
 * Toronto centre that is not its real nearest. A home just over the city line that is
 * within 5 km of a Toronto centre may get a real distance; that is accepted.
 *
 * Node-only: reads the dataset via fs on first call. Do NOT import from a browser bundle
 * (the map fetches /api/childcare/centres instead).
 */
import * as fs from 'fs';
import * as path from 'path';
import { haversineKm, type ChildCareCentre, type ChildCareFile } from './torontoChildCare';

export interface ChildCareAssignment {
  NearestChildCareKm: number;
  NearestInfantCareKm: number;
  NearestCwelccKm: number;
}

/** Beyond this radius a listing gets the sentinel — the data is Toronto only. */
export const MAX_CHILD_CARE_KM = 5;
/** Sentinel for "no centre within MAX_CHILD_CARE_KM" or an invalid location. */
export const NO_CHILD_CARE_KM = 99;
// Coarse pre-filter in degrees: 0.06° lat ≈ 6.7 km, 0.08° lng ≈ 6.4 km at 43.7°N — both
// wider than MAX_CHILD_CARE_KM, so no in-range centre is skipped.
const PREFILTER_LAT = 0.06;
const PREFILTER_LNG = 0.08;

let CENTRES: ChildCareCentre[] | null = null;

function loadCentres(): ChildCareCentre[] {
  if (CENTRES) return CENTRES;
  const file = path.join(process.cwd(), 'data', 'toronto-child-care.json');
  CENTRES = (JSON.parse(fs.readFileSync(file, 'utf-8')) as ChildCareFile).centres;
  return CENTRES;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const EMPTY: ChildCareAssignment = {
  NearestChildCareKm: NO_CHILD_CARE_KM,
  NearestInfantCareKm: NO_CHILD_CARE_KM,
  NearestCwelccKm: NO_CHILD_CARE_KM,
};

/**
 * Assign the three nearest-child-care distances to a listing location. `centres` is
 * injectable for unit tests; production reads the committed dataset.
 */
export function assignChildCare(
  location: [number, number] | null | undefined,
  centres?: ChildCareCentre[]
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
    if (!young && !c.cwelcc) continue;
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (young && d < anyKm) anyKm = d;
    if (c.infant > 0 && d < infantKm) infantKm = d;
    if (c.cwelcc && d < cwelccKm) cwelccKm = d;
  }

  const out = (d: number) => (d <= MAX_CHILD_CARE_KM ? r2(d) : NO_CHILD_CARE_KM);
  return {
    NearestChildCareKm: out(anyKm),
    NearestInfantCareKm: out(infantKm),
    NearestCwelccKm: out(cwelccKm),
  };
}

/** City of Toronto bounding box — the backfill only writes the fields inside it. */
export const TORONTO_BBOX = { minLat: 43.58, maxLat: 43.86, minLng: -79.64, maxLng: -79.11 } as const;

export function inTorontoBbox(location: [number, number] | null | undefined): boolean {
  if (!location || !Number.isFinite(location[0]) || !Number.isFinite(location[1])) return false;
  const [lat, lng] = location;
  return (
    lat >= TORONTO_BBOX.minLat && lat <= TORONTO_BBOX.maxLat && lng >= TORONTO_BBOX.minLng && lng <= TORONTO_BBOX.maxLng
  );
}
