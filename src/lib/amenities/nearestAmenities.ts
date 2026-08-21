/**
 * Nearest grocery + recreation-centre assignment for listing enrichment (ETL, Node-only).
 *
 * Loads the committed data/gta-amenities.json (built by
 * scripts/admin/build-amenities-dataset.ts from Overture Maps `places`) and, for a given
 * listing [lat, lng], finds the nearest GROCERY store and nearest RECREATION centre by
 * straight-line (haversine) distance, returning each one's distance (km) + name.
 *
 * Deterministic hardcoded math — no AI, compliant with CLAUDE.md §4. Distances use a
 * large "none nearby" sentinel (NO_AMENITY_KM) rather than 0: the Command Center
 * walkability filter is a `NearestGroceryKm:<=X` predicate, so a 0 fallback would falsely
 * match listings that have NO grocery near them. Names fall back to '' (CLAUDE.md §6).
 *
 * Node-only: reads the dataset via fs on first call. Do NOT import from a browser bundle
 * (the listing card fetches /api/amenities/nearby instead).
 */
import * as fs from 'fs';
import * as path from 'path';

export type AmenityType = 'grocery' | 'recreation' | 'transit';

export interface AmenityRecord {
  id: string;
  name: string;
  type: AmenityType;
  lat: number;
  lng: number;
  address: string;
}

export interface AmenityAssignment {
  // Straight-line km to the nearest of each type (NO_AMENITY_KM when none in range).
  NearestGroceryKm: number;
  NearestGroceryName: string;
  NearestRecCentreKm: number;
  NearestRecCentreName: string;
}

// Beyond this radius we report "none nearby" — keeps a rural listing from claiming a
// 30 km store as its "nearest" amenity.
const MAX_AMENITY_KM = 15;
// Sentinel distance for "no amenity within MAX_AMENITY_KM" (or an invalid location).
// Large so the `<=X` walkability filter can never match it. The API + UI treat any
// value >= MAX_AMENITY_KM as "none nearby".
export const NO_AMENITY_KM = 99;
// Coarse pre-filter: skip points whose lat/lng differ by more than this (~0.25° ≈ 20 km
// of longitude at this latitude, comfortably wider than MAX_AMENITY_KM).
const PREFILTER_DEG = 0.25;

let AMENITIES: AmenityRecord[] | null = null;

function loadAmenities(): AmenityRecord[] {
  if (AMENITIES) return AMENITIES;
  const file = path.join(process.cwd(), 'data', 'gta-amenities.json');
  AMENITIES = JSON.parse(fs.readFileSync(file, 'utf-8')) as AmenityRecord[];
  return AMENITIES;
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

const EMPTY: AmenityAssignment = {
  NearestGroceryKm: NO_AMENITY_KM,
  NearestGroceryName: '',
  NearestRecCentreKm: NO_AMENITY_KM,
  NearestRecCentreName: '',
};

/**
 * Assign nearest grocery + recreation centre to a listing location. Returns the
 * NO_AMENITY_KM sentinel for an invalid/missing coordinate or when nothing of that type
 * sits within MAX_AMENITY_KM. `records` is injectable for unit tests; production reads
 * the committed dataset.
 */
export function assignAmenities(
  location: [number, number] | null | undefined,
  records?: AmenityRecord[]
): AmenityAssignment {
  if (!location || !Number.isFinite(location[0]) || !Number.isFinite(location[1])) {
    return { ...EMPTY };
  }
  const [lat, lng] = location;
  const amenities = records ?? loadAmenities();

  let gKm = Infinity;
  let gName = '';
  let rKm = Infinity;
  let rName = '';

  for (const a of amenities) {
    if (Math.abs(a.lat - lat) > PREFILTER_DEG || Math.abs(a.lng - lng) > PREFILTER_DEG) continue;
    const dist = haversineKm(lat, lng, a.lat, a.lng);
    // Match BOTH types explicitly. This was `if grocery … else …`, which made the
    // recreation branch a catch-all: the moment gta-amenities.json gained transit rows,
    // every GO station would have been scored as the nearest "recreation centre" and
    // silently moved NearestRecCentreKm on ~100k listings. A new amenity type must be
    // ignored here until someone opts it in.
    if (a.type === 'grocery') {
      if (dist < gKm) {
        gKm = dist;
        gName = a.name;
      }
    } else if (a.type === 'recreation' && dist < rKm) {
      rKm = dist;
      rName = a.name;
    }
  }

  const groceryNear = gKm <= MAX_AMENITY_KM;
  const recNear = rKm <= MAX_AMENITY_KM;

  return {
    NearestGroceryKm: groceryNear ? r2(gKm) : NO_AMENITY_KM,
    NearestGroceryName: groceryNear ? gName : '',
    NearestRecCentreKm: recNear ? r2(rKm) : NO_AMENITY_KM,
    NearestRecCentreName: recNear ? rName : '',
  };
}
