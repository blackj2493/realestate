/**
 * Shared nearby-schools reader — every public/catholic school within `radiusKm` of a
 * point, sorted by distance. Extracted from /api/schools/nearby so server components
 * (address profile) and the API route share one loader + one distance implementation.
 * Server-only: reads data/ontario-schools.json (~1 MB, memoized per lambda).
 */
import * as fs from "fs";
import * as path from "path";

export interface NearbySchool {
  id: string;
  name: string;
  level: "elementary" | "secondary";
  system: "public" | "catholic";
  score: number | null;
  distanceKm: number;
}

interface RawSchool {
  id: string;
  name: string;
  level: "elementary" | "secondary";
  system: "public" | "catholic";
  lat: number;
  lng: number;
  score: number | null;
  address: string;
}

// Matches NEARBY_RADIUS_KM in src/lib/schools/nearestSchools.ts (ETL filter radius).
export const DEFAULT_SCHOOL_RADIUS_KM = 2.5;

let CACHE: RawSchool[] | null = null;

function load(): RawSchool[] {
  if (CACHE) return CACHE;
  const file = path.join(process.cwd(), "data", "ontario-schools.json");
  CACHE = JSON.parse(fs.readFileSync(file, "utf-8")) as RawSchool[];
  return CACHE;
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

export function getNearbySchools(
  lat: number,
  lng: number,
  radiusKm: number = DEFAULT_SCHOOL_RADIUS_KM,
  max: number = 30
): NearbySchool[] {
  try {
    const out: NearbySchool[] = [];
    for (const s of load()) {
      if (Math.abs(s.lat - lat) > 0.05 || Math.abs(s.lng - lng) > 0.07) continue; // coarse prefilter
      const d = haversineKm(lat, lng, s.lat, s.lng);
      if (d > radiusKm) continue;
      out.push({ id: s.id, name: s.name, level: s.level, system: s.system, score: s.score, distanceKm: d });
    }
    out.sort((a, b) => a.distanceKm - b.distanceKm);
    return out.slice(0, max);
  } catch (err) {
    console.error("[nearbySchoolList]", err);
    return [];
  }
}
