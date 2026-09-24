/**
 * Load school catchment boundaries out of `geo_features` for index-time membership.
 *
 * Server-only: this reaches the database and pulls full-resolution geometry, which is far
 * too much to ship to a browser. The membership maths it feeds (catchmentMembership.ts) is
 * pure and has no such constraint.
 *
 * NOT A COMMITTED DATASET, unlike data/ontario-schools.json. Boards redraw boundaries every
 * year and the harvester reloads them in place, so a checked-in copy would be a second
 * source of truth that drifts silently. Reading the table means an index build always uses
 * what the map is drawing.
 *
 * PAGED SMALL. These rows carry full-resolution polygons — a dissolved immersion zone is the
 * union of a dozen catchments — so the default 1,000-row page is a multi-megabyte response
 * that PostgREST will happily try to build in one go.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchoolProgram } from "@/lib/stores/commandCenterStore";
import { polygonsFromGeoJson, type CatchmentZone } from "./catchmentMembership";

const PAGE = 200;

/** Anything unrecognised is 'regular' — the value the column defaulted to before 146. */
function programOf(raw: unknown): SchoolProgram {
  return raw === "french_immersion" || raw === "extended_french" ? raw : "regular";
}

export interface CatchmentLoadResult {
  zones: CatchmentZone[];
  /** Rows read, including ones dropped below — the denominator for the guards. */
  rows: number;
  /** Rows with no `school_id`: they draw on the map but can never be filter targets. */
  withoutSchoolId: number;
  /** Rows whose geometry was not a polygon we could read. */
  unreadableGeometry: number;
}

/**
 * Every catchment that can be the target of the school filter.
 *
 * Rows without a `school_id` are dropped, deliberately: the filter selects a school by the
 * id in data/ontario-schools.json, so a boundary we cannot attribute to one can never be
 * asked for. 207 of 3,296 rows are in that state as of 2026-09-24 and they still render on
 * the map — this is about membership, not drawing.
 */
export async function fetchCatchmentZones(
  supabase: SupabaseClient
): Promise<CatchmentLoadResult> {
  const out: CatchmentLoadResult = {
    zones: [],
    rows: 0,
    withoutSchoolId: 0,
    unreadableGeometry: 0,
  };

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("geo_features")
      .select("attrs, geom")
      .eq("kind", "school_catchment")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`geo_features read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ attrs: Record<string, unknown> | null; geom: unknown }>;
    if (!rows.length) break;
    out.rows += rows.length;

    for (const r of rows) {
      const schoolId = r.attrs?.school_id;
      if (typeof schoolId !== "string" || !schoolId) {
        out.withoutSchoolId++;
        continue;
      }
      // PostGIS geometry arrives as GeoJSON through PostgREST, but a jsonb column would
      // arrive as a string. Accept both rather than depend on which one this table is.
      let geom = r.geom;
      if (typeof geom === "string") {
        try {
          geom = JSON.parse(geom);
        } catch {
          out.unreadableGeometry++;
          continue;
        }
      }
      const polygons = polygonsFromGeoJson(geom);
      if (!polygons.length) {
        out.unreadableGeometry++;
        continue;
      }
      out.zones.push({ schoolId, program: programOf(r.attrs?.program), polygons });
    }

    if (rows.length < PAGE) break;
  }

  return out;
}
