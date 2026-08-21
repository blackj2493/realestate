/**
 * Name search over the `transit` rows in data/gta-amenities.json.
 *
 * WHY LOCAL DATA AND NOT JUST MAPBOX. #411 moved /api/geocode to the Search Box API, which
 * finds Union Station and Oakville GO. It still misses on phrasing: the exact query
 * "Ajax GO Station" returns two short-term-rental listings whose titles name the station,
 * and never the station — Mapbox's own recall, nothing a parameter reaches. Every GO
 * station is in this file under its real name, so a local pass answers those queries
 * exactly, instantly, and without spending a Mapbox request.
 *
 * SERVER-ONLY (fs). Called from the /api/geocode route, which already reads data/ this way.
 */
import * as fs from "fs";
import * as path from "path";

export interface TransitStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
}

interface AmenityRow {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  address: string;
}

/** Two records this close whose names nest are one station under two spellings. */
const ALIAS_METRES = 1_000;

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const p = Math.PI / 180;
  const dLat = (bLat - aLat) * p;
  const dLng = (bLng - aLng) * p;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

let CACHE: TransitStation[] | null = null;

function load(): TransitStation[] {
  if (CACHE) return CACHE;
  const file = path.join(process.cwd(), "data", "gta-amenities.json");
  const rows = JSON.parse(fs.readFileSync(file, "utf-8")) as AmenityRow[];
  CACHE = rows
    .filter((r) => r.type === "transit")
    .map(({ id, name, lat, lng, address }) => ({ id, name, lat, lng, address }));
  return CACHE;
}

/**
 * Fold the words a rider drops or adds without thinking. "ajax go station", "Ajax GO" and
 * "ajax station" are one query to a person, and all three must reach `Ajax GO Station`.
 * Everything is compared on this form, so word order is the only thing that still matters.
 */
export function normalizeStationQuery(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["go", "station", "stn", "the", "transit"].includes(w));
}

/**
 * Rank: a station whose name CONTAINS every meaningful word of the query. Shorter names
 * win, so "Ajax GO Station" beats "Ajax GO Station Parking" and Union Station's plain
 * record beats "Union Station Train Terminal".
 *
 * Returns [] for a query with no meaningful words left ("go", "station") rather than
 * every station in the GTA.
 */
export function rankStations(stations: TransitStation[], query: string, limit = 4): TransitStation[] {
  const words = normalizeStationQuery(query);
  if (!words.length) return [];

  const hits = stations
    .map((s) => ({ s, hay: normalizeStationQuery(s.name) }))
    .filter(({ hay }) => words.every((w) => hay.some((h) => h.startsWith(w))))
    .sort((a, b) => a.s.name.length - b.s.name.length || a.s.name.localeCompare(b.s.name));

  // Collapse aliases of one station. Overture files Union Station eight ways and some sit
  // far enough apart to survive the build's 250 m sweep — "Union Station" on Front St,
  // "Union Station Toronto" with no address, "Union Station Train Terminal".
  //
  // The rule is SUBSET PLUS DISTANCE, not an equal-name check: an alias is the kept name
  // with extra words, so drop a candidate when a station already kept has ALL of its words
  // and stands within ALIAS_METRES. Word equality here is exact, unlike the prefix matching
  // above — "union" must not swallow "unionville", which is a different station 25 km away.
  const out: TransitStation[] = [];
  const keptWords: Array<{ words: string[]; lat: number; lng: number }> = [];
  const seenExact = new Set<string>();
  for (const { s, hay } of hits) {
    // An identical name is the same station, at any distance — no two stations share one.
    // Needed because Overture's coordinates for an alias can be badly wrong: it carries
    // "Union Station Toronto" twice, 3.6 km and 13.6 km from the real platform, so the
    // distance rule below cannot see that they are the same row.
    const exact = hay.join(" ");
    if (seenExact.has(exact)) continue;
    seenExact.add(exact);

    const alias = keptWords.some(
      (k) => k.words.every((w) => hay.includes(w)) && haversineM(k.lat, k.lng, s.lat, s.lng) < ALIAS_METRES
    );
    if (alias) continue;
    keptWords.push({ words: hay, lat: s.lat, lng: s.lng });
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** Stations matching `query`, best first. Empty for a query that names none. */
export function searchTransit(query: string, limit = 4): TransitStation[] {
  return rankStations(load(), query, limit);
}
