/**
 * Zoning overlay API — viewport-scoped municipal zoning polygons.
 *
 * GET /api/zoning?bbox=west,south,east,north&zoom=14
 * Returns a GeoJSON FeatureCollection of zoning polygons intersecting the viewport
 * (feature props: { code, desc, source }), plus the licence `attribution` the overlay
 * must show — the union of the distinct sources actually in view.
 *
 * Backed by the zoning_in_bbox() PostGIS RPC (migration 050) over geo_features
 * (kind='zoning'): ONE GIST-indexed bbox query, geometry simplified server-side by zoom,
 * exactly like the school-catchment overlay. (Superseded the old in-memory 50 MB CKAN
 * load, which held the whole city in every serverless instance's heap.) Only serves at
 * zoom ≥ 13 so the in-view polygon count stays sane. Best-effort: any failure → empty.
 *
 * Sources are municipal OPEN DATA (OGL etc.); provenance/attribution live in
 * src/lib/zoning/attribution.ts and are loaded by scripts/admin/load-zoning.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { ZONING_SOURCES } from "@/lib/zoning/attribution";

const EMPTY = { type: "FeatureCollection" as const, features: [] };
const MIN_ZOOM = 13;

// Simplify tolerance (degrees) by zoom — coarser when zoomed out to bound payload size.
function tolForZoom(z: number): number {
  if (z >= 16) return 0;
  if (z >= 14) return 0.00005;
  if (z >= 13) return 0.0001;
  return 0.0002;
}

interface ZoneRow {
  code: string | null;
  description: string | null;
  source: string | null;
  geometry: unknown;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const bbox = sp.get("bbox");
    if (!bbox) return NextResponse.json(EMPTY);
    const [w, s, e, n] = bbox.split(",").map(Number);
    if (![w, s, e, n].every(Number.isFinite)) return NextResponse.json(EMPTY);
    if ((Number(sp.get("zoom")) || 0) < MIN_ZOOM) return NextResponse.json(EMPTY);

    const supabase = getServiceRoleClient();
    const { data, error } = await supabase.rpc("zoning_in_bbox", {
      min_lng: w,
      min_lat: s,
      max_lng: e,
      max_lat: n,
      tol: tolForZoom(Number(sp.get("zoom")) || MIN_ZOOM),
    });
    if (error) {
      console.error("[zoning API]", error.message);
      return NextResponse.json(EMPTY);
    }

    const rows = (data as ZoneRow[]) ?? [];
    const features = rows
      .filter((r) => r.geometry)
      .map((r) => ({
        type: "Feature" as const,
        geometry: r.geometry,
        properties: { code: r.code, desc: r.description, source: r.source },
      }));

    // Attribution = union of the distinct sources actually in view (each licence's
    // required string), so the legend stays correct as more municipalities are loaded.
    const keys = [...new Set(rows.map((r) => r.source).filter(Boolean) as string[])];
    const attribution =
      keys.map((k) => ZONING_SOURCES[k]?.attribution).filter(Boolean).join(" ") ||
      ZONING_SOURCES.toronto.attribution;

    return NextResponse.json(
      { type: "FeatureCollection", features, attribution },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } }
    );
  } catch (err) {
    console.error("[zoning API]", err);
    return NextResponse.json(EMPTY);
  }
}
