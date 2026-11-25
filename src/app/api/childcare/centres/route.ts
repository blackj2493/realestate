/**
 * GET /api/childcare/centres
 *
 * Every City of Toronto licensed child care centre as a compact GeoJSON
 * FeatureCollection, for the map's "Show centres on the map" pins (Child care tool).
 * ~1,100 points, so one cacheable response covers the whole city; the source JSON
 * (data/toronto-child-care.json, with neighbourhood polygons) never ships to the client.
 */
import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import type { ChildCareFile } from "@/lib/childcare/torontoChildCare";
import { buildCentresGeoJson, type ChildCareCentresGeoJson } from "@/lib/childcare/centresGeoJson";

let CACHE: ChildCareCentresGeoJson | null = null;

export async function GET() {
  try {
    if (!CACHE) {
      const file = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "data", "toronto-child-care.json"), "utf-8")
      ) as ChildCareFile;
      CACHE = buildCentresGeoJson(file);
    }
    return NextResponse.json(CACHE, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch {
    return NextResponse.json({ error: "child care data unavailable" }, { status: 500 });
  }
}
