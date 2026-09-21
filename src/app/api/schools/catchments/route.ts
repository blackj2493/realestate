/**
 * School catchment overlay API
 *
 * GET /api/schools/catchments?bbox=west,south,east,north&panel=elementary&system=public&program=regular&zoom=12
 * Returns a GeoJSON FeatureCollection of attendance-boundary polygons intersecting
 * the viewport, via the school_catchments_in_bbox PostGIS RPC (migrations 038 + 146).
 * Geometry is simplified server-side by zoom so payloads stay small.
 *
 * `system` omitted (or "either") returns both public + catholic. 'combined' zones
 * (boards that don't split elementary/secondary) always match a panel. Best-effort:
 * any failure returns an empty collection so the overlay degrades silently.
 *
 * `program` is the second axis: regular (default) | french_immersion | extended_french.
 * A program zone overlaps the regular zones it draws from and runs several times larger,
 * so the two are never drawn together unfiltered. The default keeps a caller that omits
 * the parameter on home catchments only.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";

const PROGRAMS = ["regular", "french_immersion", "extended_french"] as const;
type Program = (typeof PROGRAMS)[number];
/** Reject an unknown value rather than pass it to the RPC, where it would match no row
 *  and read as "this board has no zones" instead of "that is not a program". */
function parseProgram(raw: string | null): Program | null {
  if (!raw || raw === "regular") return "regular";
  if (raw === "any") return null; // every program, for the focus view
  return (PROGRAMS as readonly string[]).includes(raw) ? (raw as Program) : "regular";
}

interface CatchmentRow {
  school_name: string | null;
  panel: string | null;
  program: string | null;
  grades: string | null;
  system: string | null;
  board: string | null;
  board_code: string | null;
  language: string | null;
  year: string | null;
  school_id: string | null;
  score: number | null;
  source: string | null;
  geometry: unknown;
}

// Simplify tolerance (degrees) by zoom — coarser when zoomed out to bound payload size.
function tolForZoom(z: number): number {
  if (z >= 14) return 0;
  if (z >= 12) return 0.0001;
  if (z >= 10) return 0.0003;
  return 0.0008;
}

const EMPTY = { type: "FeatureCollection" as const, features: [] };

function toFC(rows: CatchmentRow[]) {
  return {
    type: "FeatureCollection" as const,
    features: (rows ?? [])
      .filter((r) => r.geometry)
      .map((r) => ({
        type: "Feature" as const,
        geometry: r.geometry,
        properties: {
          school_name: r.school_name,
          panel: r.panel,
          program: r.program ?? "regular",
          grades: r.grades,
          system: r.system,
          board: r.board,
          boardCode: r.board_code,
          language: r.language,
          year: r.year,
          school_id: r.school_id,
          score: r.score,
          source: r.source,
        },
      })),
  };
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const supabase = getServiceRoleClient();

    // Focus mode: one school's real catchment, by joined EQAO school_id. Used when a
    // user picks a specific school so we show its actual boundary, not the fallback
    // circle (the circle is only for schools whose boundary we don't have).
    const schoolId = sp.get("schoolId");
    if (schoolId) {
      // Focus mode asks for every program by default: a school that runs French
      // Immersion has both a regular zone and a far larger FI zone, and the caller
      // needs both to label them apart.
      const { data, error } = await supabase.rpc("school_catchment_by_id", {
        p_school_id: schoolId,
        tol: 0,
        p_program: parseProgram(sp.get("program") ?? "any"),
      });
      if (error) {
        console.error("[catchments API]", error.message);
        return NextResponse.json(EMPTY);
      }
      return NextResponse.json(toFC(data as CatchmentRow[]), {
        headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
      });
    }

    // Overlay mode: all catchments intersecting the viewport.
    const bbox = sp.get("bbox");
    if (!bbox) return NextResponse.json(EMPTY);
    const [w, s, e, n] = bbox.split(",").map(Number);
    if (![w, s, e, n].every(Number.isFinite)) return NextResponse.json(EMPTY);

    const panel = sp.get("panel");
    const systemParam = sp.get("system");
    const zoom = Number(sp.get("zoom")) || 11;

    const { data, error } = await supabase.rpc("school_catchments_in_bbox", {
      min_lng: w,
      min_lat: s,
      max_lng: e,
      max_lat: n,
      p_panel: panel || null,
      p_system: systemParam && systemParam !== "either" ? systemParam : null,
      tol: tolForZoom(zoom),
      p_program: parseProgram(sp.get("program")),
    });

    if (error) {
      console.error("[catchments API]", error.message);
      return NextResponse.json(EMPTY);
    }

    return NextResponse.json(toFC(data as CatchmentRow[]), {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" },
    });
  } catch (err) {
    console.error("[catchments API]", err);
    return NextResponse.json(EMPTY);
  }
}
