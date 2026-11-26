/**
 * GET /api/childcare/centres
 *
 * Every licensed child care centre for children under school age as a compact GeoJSON
 * FeatureCollection, for the map's "Show centres on the map" pins (Child care tool):
 * ~1,000 City of Toronto centres (`detail: true`, spaces by age) plus ~3,300 Ontario
 * ministry centres outside Toronto (`detail: false`, approximate postal-code points).
 * One cacheable response (~0.5 MB raw, much less gzipped) covers the province; the source
 * JSON (with Toronto neighbourhood polygons) never ships to the client.
 */
import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import type { ChildCareFile } from "@/lib/childcare/torontoChildCare";
import type { OntarioChildCareFile } from "@/lib/childcare/ontarioChildCare";
import { buildCentresGeoJson, type ChildCareCentresGeoJson } from "@/lib/childcare/centresGeoJson";

let CACHE: ChildCareCentresGeoJson | null = null;

export async function GET() {
  try {
    if (!CACHE) {
      // Literal paths so the deploy's file tracing finds both files.
      const toronto = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "data", "toronto-child-care.json"), "utf-8")
      ) as ChildCareFile;
      const ontario = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "data", "ontario-child-care.json"), "utf-8")
      ) as OntarioChildCareFile;
      CACHE = buildCentresGeoJson(toronto, ontario);
    }
    return NextResponse.json(CACHE, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch {
    return NextResponse.json({ error: "child care data unavailable" }, { status: 500 });
  }
}
