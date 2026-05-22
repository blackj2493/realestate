/**
 * Nearby schools API Route
 *
 * GET /api/schools/nearby?lat=..&lng=..&radius=2.5
 * Returns every public/catholic school within `radius` km of a point, sorted by
 * distance, for the "Schools near this home" block in the listing terminal. Mirrors
 * the NearbySchools filter membership (same 2.5 km radius, rated AND unrated) so the
 * school a user searched for always appears on a matched listing.
 *
 * Loaded server-side (the 1 MB dataset never ships to the client bundle).
 */
import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

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

export interface NearbySchoolResult {
  id: string;
  name: string;
  level: "elementary" | "secondary";
  system: "public" | "catholic";
  score: number | null;
  distanceKm: number;
}

// Matches NEARBY_RADIUS_KM in src/lib/schools/nearestSchools.ts (ETL filter radius).
const DEFAULT_RADIUS_KM = 2.5;
const MAX_RESULTS = 30;

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

export async function GET(req: NextRequest) {
  try {
    const lat = Number(req.nextUrl.searchParams.get("lat"));
    const lng = Number(req.nextUrl.searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ results: [] });
    }
    const radius = Number(req.nextUrl.searchParams.get("radius")) || DEFAULT_RADIUS_KM;

    const schools = load();
    const results: NearbySchoolResult[] = [];
    // Coarse pre-filter (~0.05° ≈ 5.5 km lat) before the haversine.
    const box = radius / 75;
    for (const s of schools) {
      if (Math.abs(s.lat - lat) > box + 0.02 || Math.abs(s.lng - lng) > box + 0.03) continue;
      const distanceKm = haversineKm(lat, lng, s.lat, s.lng);
      if (distanceKm > radius) continue;
      results.push({
        id: s.id,
        name: s.name,
        level: s.level,
        system: s.system,
        score: s.score,
        distanceKm: Math.round(distanceKm * 100) / 100,
      });
    }

    results.sort((a, b) => a.distanceKm - b.distanceKm);

    return NextResponse.json({ results: results.slice(0, MAX_RESULTS), total: results.length });
  } catch (err) {
    console.error("[Schools nearby API]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
