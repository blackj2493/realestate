/**
 * GET /api/childcare/nearby?lat=..&lng=..
 *
 * Licensed child care centres within 1 km of a point, for the "Child care" block on the
 * listing page. Two sources, both committed files that never ship to the client:
 *   - inside a City of Toronto neighbourhood: data/toronto-child-care.json (spaces by age,
 *     $10-a-day, the neighbourhood rank) → `scope: "toronto"`, unchanged otherwise;
 *   - elsewhere in Ontario: data/ontario-child-care.json (ministry list, a count of centres
 *     with postal-code locations) → `scope: "ontario"`.
 * `covered: false` only when the point is outside Toronto and has no Ontario centre within
 * 5 km (outside the province, or very remote): say nothing rather than "0 centres".
 */
import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { nearbyChildCare, type ChildCareFile, type NearbyChildCare } from "@/lib/childcare/torontoChildCare";
import {
  hasOntarioCentreWithin,
  nearbyOntarioChildCare,
  type NearbyOntarioChildCare,
  type OntarioChildCareFile,
} from "@/lib/childcare/ontarioChildCare";

let TORONTO: ChildCareFile | null = null;
let ONTARIO: OntarioChildCareFile | null = null;
// Literal paths (not a helper taking a name) so the deploy's file tracing finds both files.
function loadToronto(): ChildCareFile {
  if (!TORONTO) TORONTO = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "toronto-child-care.json"), "utf-8")) as ChildCareFile;
  return TORONTO;
}
function loadOntario(): OntarioChildCareFile {
  if (!ONTARIO) {
    ONTARIO = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "ontario-child-care.json"), "utf-8")) as OntarioChildCareFile;
  }
  return ONTARIO;
}

export type TorontoChildCareResponse = { covered: true; scope: "toronto" } & NearbyChildCare;
export type OntarioChildCareResponse = { covered: true; scope: "ontario" } & NearbyOntarioChildCare;
export type ChildCareResponse = TorontoChildCareResponse | OntarioChildCareResponse | { covered: false };

const CACHE = { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" };

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ covered: false } satisfies ChildCareResponse);
  try {
    const r = nearbyChildCare(loadToronto(), lat, lng);
    if (r.neighbourhood) {
      return NextResponse.json({ covered: true, scope: "toronto", ...r } satisfies ChildCareResponse, { headers: CACHE });
    }
    const ontario = loadOntario();
    const body: ChildCareResponse = hasOntarioCentreWithin(ontario, lat, lng)
      ? { covered: true, scope: "ontario", ...nearbyOntarioChildCare(ontario, lat, lng) }
      : { covered: false };
    return NextResponse.json(body, { headers: CACHE });
  } catch {
    return NextResponse.json({ covered: false } satisfies ChildCareResponse);
  }
}
