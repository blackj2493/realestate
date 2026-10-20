/**
 * School-by-id lookup. Returns the school's lat/lng (the search route omits it
 * to keep the autocomplete payload small). Used by SaveBubbleDialog to
 * synthesize the ~2.5 km circle polygon for a school market bubble.
 *
 *   GET /api/schools/[id]
 *   → { id, name, level, system, lat, lng, score, address, programs }
 *
 * `programs` lists the programs the school publishes an attendance boundary for. The
 * dashboard scopes a saved school area by it, the same way the nightly brief does.
 */

import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { fetchCatchmentPrograms } from "@/lib/schools/catchmentPrograms";

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

let CACHE: RawSchool[] | null = null;
function load(): RawSchool[] {
  if (CACHE) return CACHE;
  const file = path.join(process.cwd(), "data", "ontario-schools.json");
  CACHE = JSON.parse(fs.readFileSync(file, "utf-8")) as RawSchool[];
  return CACHE;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const schools = load();
  const school = schools.find((s) => s.id === id);
  if (!school) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Best-effort: a failed lookup returns an empty map, and every caller keeps the radius.
  const programs = (await fetchCatchmentPrograms(getServiceRoleClient(), [id])).get(id) ?? [];
  return NextResponse.json({ school: { ...school, programs } });
}
