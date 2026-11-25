/**
 * GET /api/childcare/nearby?lat=..&lng=..
 *
 * Licensed child care centres within 1 km of a point in Toronto, for the "Child care"
 * block on the listing page. Reads the committed data/toronto-child-care.json (see
 * src/lib/childcare/torontoChildCare.ts); the ~0.9 MB file never ships to the client.
 * Outside Toronto every centre is far away, so the response says `covered: false`.
 */
import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { nearbyChildCare, type ChildCareFile, type NearbyChildCare } from "@/lib/childcare/torontoChildCare";

let CACHE: ChildCareFile | null = null;
function load(): ChildCareFile {
  if (!CACHE) CACHE = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "toronto-child-care.json"), "utf-8")) as ChildCareFile;
  return CACHE;
}

export type ChildCareResponse = ({ covered: true } & NearbyChildCare) | { covered: false };

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ covered: false } satisfies ChildCareResponse);
  try {
    const r = nearbyChildCare(load(), lat, lng);
    // Inside no Toronto neighbourhood = outside the city: say nothing rather than "0 centres".
    const body: ChildCareResponse = r.neighbourhood ? { covered: true, ...r } : { covered: false };
    return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch {
    return NextResponse.json({ covered: false } satisfies ChildCareResponse);
  }
}
