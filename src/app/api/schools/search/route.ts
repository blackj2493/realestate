/**
 * School search API Route
 *
 * GET /api/schools/search?q=...
 * Substring-searches the committed Ontario schools dataset for the target-school
 * autocomplete in SchoolFilter. Returns { id, name, system, level, city, score }.
 * Loaded server-side (the 1 MB dataset never ships to the client bundle).
 */
import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { getServiceRoleClient } from "@/lib/supabase/client";
import type { SchoolProgram } from "@/lib/stores/commandCenterStore";

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

export interface SchoolSearchResult {
  id: string;
  name: string;
  level: "elementary" | "secondary";
  system: "public" | "catholic";
  city: string;
  score: number | null;
  /**
   * Programs this school publishes an attendance boundary for.
   *
   * It decides which question the filter can answer: with a boundary it returns the homes
   * INSIDE the zone, without one it falls back to a 2.5 km radius — see
   * buildSchoolFilterClause. Empty is a normal answer; plenty of boards publish nothing.
   */
  programs: SchoolProgram[];
}

/**
 * Which programs each of these schools publishes a catchment for.
 *
 * Attributes only — never `geom`. This runs on every keystroke of the autocomplete, and the
 * polygons are full-resolution: a dissolved immersion zone is the union of a dozen
 * catchments, so selecting geometry here would move megabytes to answer a yes/no question.
 *
 * Best-effort by design. A failed read returns an empty map, every school then reads as
 * "no catchment", and the filter falls back to the radius it has always used. Degrading to
 * the old behaviour is the right failure for a database hiccup on a typeahead.
 */
async function catchmentProgramsFor(ids: string[]): Promise<Map<string, SchoolProgram[]>> {
  const out = new Map<string, SchoolProgram[]>();
  if (!ids.length) return out;
  try {
    const { data, error } = await getServiceRoleClient()
      .from("geo_features")
      .select("attrs")
      .eq("kind", "school_catchment")
      .in("attrs->>school_id", ids);
    if (error) {
      console.warn("[Schools search API] catchment lookup failed:", error.message);
      return out;
    }
    for (const row of (data ?? []) as Array<{ attrs: Record<string, unknown> | null }>) {
      const id = row.attrs?.school_id;
      if (typeof id !== "string") continue;
      const raw = row.attrs?.program;
      const program: SchoolProgram =
        raw === "french_immersion" || raw === "extended_french" ? raw : "regular";
      const list = out.get(id);
      if (!list) out.set(id, [program]);
      else if (!list.includes(program)) list.push(program);
    }
  } catch (e) {
    console.warn("[Schools search API] catchment lookup threw:", e instanceof Error ? e.message : e);
  }
  return out;
}

let CACHE: RawSchool[] | null = null;

function load(): RawSchool[] {
  if (CACHE) return CACHE;
  const file = path.join(process.cwd(), "data", "ontario-schools.json");
  CACHE = JSON.parse(fs.readFileSync(file, "utf-8")) as RawSchool[];
  return CACHE;
}

const cityOf = (address: string) => {
  const parts = address.split(",").map((p) => p.trim());
  return parts.length >= 3 ? parts[1] : "";
};

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase();
    if (!q || q.length < 2) return NextResponse.json({ results: [] });

    const schools = load();
    const matches = schools.filter((s) => s.name.toLowerCase().includes(q));

    // Rank: prefix matches first, then higher-scored, then shorter name.
    matches.sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const as = a.score ?? -1;
      const bs = b.score ?? -1;
      if (bs !== as) return bs - as;
      return a.name.length - b.name.length;
    });

    const top = matches.slice(0, 12);
    const programs = await catchmentProgramsFor(top.map((s) => s.id));

    const results: SchoolSearchResult[] = top.map((s) => ({
      id: s.id,
      name: s.name,
      level: s.level,
      system: s.system,
      city: cityOf(s.address),
      score: s.score,
      programs: programs.get(s.id) ?? [],
    }));

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[Schools search API]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
