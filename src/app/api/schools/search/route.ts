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

    const results: SchoolSearchResult[] = matches.slice(0, 12).map((s) => ({
      id: s.id,
      name: s.name,
      level: s.level,
      system: s.system,
      city: cityOf(s.address),
      score: s.score,
    }));

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[Schools search API]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
