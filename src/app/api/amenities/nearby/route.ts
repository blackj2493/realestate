/**
 * Nearby amenities API route.
 *
 * GET /api/amenities/nearby?lat=..&lng=..&radius=3
 * Returns the nearest grocery stores and recreation centres within `radius` km of a
 * point, grouped by type and sorted by distance, for the "What's nearby" block on the
 * listing terminal. Mirrors the NearbySchools route pattern.
 *
 * Loaded server-side (the ~800 KB dataset never ships to the client bundle).
 * Source: Overture Maps `places` (CDLA-Permissive 2.0; attribution carried in the UI).
 */
import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

type AmenityType = "grocery" | "recreation";

interface RawAmenity {
  id: string;
  name: string;
  type: AmenityType;
  lat: number;
  lng: number;
  address: string;
}

export interface NearbyAmenityResult {
  id: string;
  name: string;
  distanceKm: number;
  address: string;
}

const DEFAULT_RADIUS_KM = 3;
const MAX_PER_TYPE = 8;
// Costco is a drive-to destination, not a walkable amenity, so it's searched well
// beyond the walkable radius. Beyond this we report "no Costco nearby".
const COSTCO_MAX_KM = 60;

let CACHE: RawAmenity[] | null = null;

function load(): RawAmenity[] {
  if (CACHE) return CACHE;
  const file = path.join(process.cwd(), "data", "gta-amenities.json");
  CACHE = JSON.parse(fs.readFileSync(file, "utf-8")) as RawAmenity[];
  return CACHE;
}

interface CostcoSite {
  id: string;
  name: string;
  lat: number;
  lng: number;
}
let COSTCO_CACHE: CostcoSite[] | null = null;

function loadCostco(): CostcoSite[] {
  if (COSTCO_CACHE) return COSTCO_CACHE;
  const file = path.join(process.cwd(), "data", "costco-locations.json");
  COSTCO_CACHE = JSON.parse(fs.readFileSync(file, "utf-8")) as CostcoSite[];
  return COSTCO_CACHE;
}

/** Nearest Costco warehouse to a point (km), or null when none within COSTCO_MAX_KM. */
function nearestCostco(lat: number, lng: number): { name: string; distanceKm: number } | null {
  let bestKm = Infinity;
  let bestName = "";
  for (const s of loadCostco()) {
    const d = haversineKm(lat, lng, s.lat, s.lng);
    if (d < bestKm) {
      bestKm = d;
      bestName = s.name;
    }
  }
  return bestKm <= COSTCO_MAX_KM ? { name: bestName, distanceKm: Math.round(bestKm * 100) / 100 } : null;
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
      return NextResponse.json({ grocery: [], recreation: [], groceryTotal: 0, recreationTotal: 0, costco: null });
    }
    const radius = Number(req.nextUrl.searchParams.get("radius")) || DEFAULT_RADIUS_KM;

    const amenities = load();
    const grocery: NearbyAmenityResult[] = [];
    const recreation: NearbyAmenityResult[] = [];
    // Coarse pre-filter (~0.05° ≈ 5.5 km lat) before the haversine.
    const box = radius / 75;
    for (const a of amenities) {
      if (Math.abs(a.lat - lat) > box + 0.02 || Math.abs(a.lng - lng) > box + 0.03) continue;
      const distanceKm = haversineKm(lat, lng, a.lat, a.lng);
      if (distanceKm > radius) continue;
      const row: NearbyAmenityResult = {
        id: a.id,
        name: a.name,
        distanceKm: Math.round(distanceKm * 100) / 100,
        address: a.address,
      };
      (a.type === "grocery" ? grocery : recreation).push(row);
    }

    grocery.sort((x, y) => x.distanceKm - y.distanceKm);
    recreation.sort((x, y) => x.distanceKm - y.distanceKm);

    return NextResponse.json({
      grocery: grocery.slice(0, MAX_PER_TYPE),
      recreation: recreation.slice(0, MAX_PER_TYPE),
      groceryTotal: grocery.length,
      recreationTotal: recreation.length,
      costco: nearestCostco(lat, lng),
    });
  } catch (err) {
    console.error("[Amenities nearby API]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
