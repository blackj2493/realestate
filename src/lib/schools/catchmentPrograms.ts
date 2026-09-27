/**
 * Which programs a school publishes an attendance boundary for.
 *
 * The one question every catchment-vs-radius decision turns on. `SchoolCatchments` holds a
 * `<school_id>|<program>` token per containing boundary, so filtering on a token for a
 * school that publishes none returns NOTHING — silently, and for every listing. Asking this
 * first is what lets the caller fall back to the 2.5 km radius instead.
 *
 * ATTRIBUTES ONLY, NEVER `geom`. This answers a yes/no question, and the polygons are
 * full-resolution — a dissolved immersion zone is the union of a dozen catchments. Selecting
 * geometry here would move megabytes to decide which of two strings to emit.
 *
 * Server-only: it reaches the database.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchoolProgram } from "@/lib/stores/commandCenterStore";

/** Anything unrecognised is 'regular' — the value the column defaulted to before 146. */
function programOf(raw: unknown): SchoolProgram {
  return raw === "french_immersion" || raw === "extended_french" ? raw : "regular";
}

/**
 * school id → the programs it publishes a boundary for. Missing id = no boundaries.
 *
 * BEST-EFFORT BY DESIGN. A failed read returns an empty map, every school then reads as
 * "no catchment", and every caller falls back to the radius it has always used. Degrading to
 * the previous behaviour is the right failure here: the alternative is a filter that matches
 * nothing because a database blip made us claim a boundary we could not confirm.
 */
export async function fetchCatchmentPrograms(
  supabase: SupabaseClient,
  schoolIds: readonly string[]
): Promise<Map<string, SchoolProgram[]>> {
  const out = new Map<string, SchoolProgram[]>();
  const ids = [...new Set(schoolIds.filter(Boolean))];
  if (!ids.length) return out;

  try {
    const { data, error } = await supabase
      .from("geo_features")
      .select("attrs")
      .eq("kind", "school_catchment")
      .in("attrs->>school_id", ids);
    if (error) {
      console.warn(`[catchmentPrograms] lookup failed (${error.message}) — falling back to radius`);
      return out;
    }
    for (const row of (data ?? []) as Array<{ attrs: Record<string, unknown> | null }>) {
      const id = row.attrs?.school_id;
      if (typeof id !== "string") continue;
      const program = programOf(row.attrs?.program);
      const list = out.get(id);
      if (!list) out.set(id, [program]);
      else if (!list.includes(program)) list.push(program);
    }
  } catch (e) {
    // supabase-js REJECTS on a dropped fetch instead of returning { error }.
    console.warn(
      "[catchmentPrograms] lookup threw — falling back to radius:",
      e instanceof Error ? e.message : e
    );
  }
  return out;
}
