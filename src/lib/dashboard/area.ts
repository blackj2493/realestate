/**
 * Area abstraction — unifies how the dashboard scopes its market queries.
 *
 * Today the dashboard scopes per-region by a string (a TRREB City or CityRegion).
 * Market Bubbles introduce two more scoping kinds: a drawn/commute polygon, and
 * a school catchment (which the ETL precomputes as listing → NearbySchools[]).
 * This module collapses all three into a single discriminated union so the rest
 * of the dashboard data layer (queries.ts, MarketActivityPanel, RegionStatTiles,
 * PlaylistBoard) doesn't need to care which kind of area it's serving.
 *
 * Compliance / data-gap notes:
 *   - All filters are deterministic JS that produces Typesense filter_by strings
 *     (CLAUDE.md §4 — no LLM, no AI on raw IDX/VOW).
 *   - The `sold_listings` collection gained `location` + `NearbySchools` in
 *     Phase 2B (see soldListingsSchema.ts), so every area kind now supports
 *     sold-comp queries — no `supportsSold` gate needed.
 */

import type { Bubble } from "@/lib/bubbles/serialize";
import { OTTAWA_AREAS } from "./ottawaAreas";
// 34 rows keyed by raw feed City strings (~2KB). Imported directly rather than through
// lib/postalCodes, which pulls in `fs` and so can't be reached from a client component.
import cityCentroidsData from "@/data/city-centroids.json";

export type Area =
  | { kind: "region"; name: string }
  | {
      kind: "polygon";
      /** Stable key — bubble id when sourced from a Bubble. */
      key: string;
      /** Display label (bubble name). */
      label: string;
      /** Polygon ring in [lat, lng] order (matches Typesense location filter). */
      polygon: [number, number][];
    }
  | {
      kind: "school";
      key: string;
      label: string;
      /** School id as indexed in `NearbySchools` on the properties collection. */
      schoolKey: string;
      /** Synthesized circle polygon (kept for symmetry / future use). */
      polygon: [number, number][];
    };

/**
 * Grouped parent cities that TRREB does NOT store as a single City value, so an exact
 * City:=`Name` match hits ~nothing and the dashboard section renders empty. A region set
 * to the PARENT name expands to the whole group below:
 *   • Toronto — ~36 district codes ("Toronto C01" … "Toronto W10").
 *   • London  — directional names ("London South", …).
 *   • Ottawa  — ~51 OREB-style area names (Kanata, Barrhaven, Orleans, …); see ottawaAreas.
 * Ranges/lists verified against the live City facet. Single-value cities (Mississauga,
 * Brampton, …) aren't listed → no expansion. The city-hub tree resolves district-split
 * cities DYNAMICALLY (citiesForHubSlug, async); this is the synchronous counterpart the
 * dashboard's sync filter builder needs. A single sub-area (e.g. "Orleans - Cumberland and
 * Area") added on its own is NOT a key here → exact match → its own focused section.
 */
function torontoDistricts(): string[] {
  const out = ["Toronto"];
  for (const [p, n] of [["C", 15], ["E", 11], ["W", 10]] as const)
    for (let i = 1; i <= n; i++) out.push(`Toronto ${p}${String(i).padStart(2, "0")}`);
  return out;
}
export const CITY_GROUPS: Record<string, string[]> = {
  Toronto: torontoDistricts(),
  London: ["London", "London North", "London South", "London East", "London West"],
  Ottawa: OTTAWA_AREAS,
};

/**
 * Colloquial UMBRELLA community names that TRREB does NOT store as a single CityRegion
 * value — an exact `CityRegion:=\`Name\`` match hits ~nothing, so a dashboard section (or the
 * onboarding email's example) built from the bare name renders empty. TRREB splits these
 * into directional/sub-communities; a name here expands to its real CityRegion members.
 *   • Woodbridge (Vaughan) → "East Woodbridge" + "West Woodbridge".
 *
 * Members are LIVE CityRegion facet values (verified against the properties collection).
 * Distinct from CITY_GROUPS, whose members are CITY values: these are CityRegion values
 * under one parent city, so the expansion filters CityRegion, not City.
 *
 * This is only reached for a colloquial name used RAW (hardcoded like EXAMPLE_REGION, or a
 * legacy seed) — real user saves already pick the exact member ("East Woodbridge") from the
 * facet-backed search, and those resolve through the exact-match branch untouched. Keep this
 * table SHORT: an entry is only needed for an umbrella name something actually passes raw.
 */
export const COMMUNITY_ALIASES: Record<string, string[]> = {
  Woodbridge: ["East Woodbridge", "West Woodbridge"],
};

/**
 * The region string to SAVE for a listing's raw TRREB `City` value.
 *
 * A listing's City is often a sub-value of a real municipality — "Toronto C12",
 * "London South", "Barrhaven". Saving that verbatim is not wrong (areaFilter matches it
 * exactly) but it scopes a new user's whole dashboard to one district of one city, which
 * reads as broken inventory. Roll a member up to its CITY_GROUPS parent so the seed means
 * "this city" rather than "the one district that listing happened to sit in".
 *
 * Driven off CITY_GROUPS — the same table areaFilter expands — so anything this returns
 * provably resolves to inventory. Deliberately NOT the `municipality()` string-strip in
 * listingPath: that handles Toronto/London by pattern but has no rule for Ottawa's OREB
 * names ("Kanata" → "Ottawa" is a membership fact, not a suffix rule; see ottawaAreas).
 *
 * A city in no group (Mississauga, Burlington, …) passes through unchanged.
 */
export function regionForCity(city: string | null | undefined): string | null {
  const raw = (city ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const [parent, members] of Object.entries(CITY_GROUPS)) {
    if (parent.toLowerCase() === lower) return parent;
    if (members.some((m) => m.toLowerCase() === lower)) return parent;
  }
  return raw;
}

export interface QuickPickMarket {
  /** Display label AND the region value written to config.regions. */
  name: string;
  /** Opening map camera. See the note below on why this is a camera, not a filter. */
  lat: number;
  lng: number;
  zoom: number;
}

/**
 * One-tap markets offered wherever we ask a user to choose a starting area — the
 * /welcome first-run seed and the dashboard's MarketPicker. Every name must
 * resolve to real inventory through areaFilter above, so "Toronto", "Ottawa" and "London"
 * are GROUPS (TRREB has no single City value for any of them) that expand to their whole
 * City-group. Anything finer (Orleans, Kanata) is reached via location search, not here.
 * Keep this list short — it is a starting point the user edits later, not a taxonomy.
 *
 * The coordinates exist because a first-run user is EXPLORING, not searching. Seeding
 * them with a city text filter pins the terminal to that city, and panning one street
 * past the boundary empties the map with no explanation. Seeding the CAMERA instead
 * leaves the query unfiltered, so results follow the viewport and panning just works.
 * The city filter is the right model only when the user deliberately typed a place.
 *
 * data/city-centroids.json is NOT usable for THIS list — it is keyed by raw TRREB City
 * strings (it has "Toronto C01" but no "Toronto") and covers only 34 geocoding fallbacks.
 * These are hand-set, cross-checked against that file for the four it does contain, with
 * zoom chosen per market so a dense core and a spread-out suburb both frame sensibly.
 * (That file IS the right source one level down — see regionCamera below, where the
 * missing names are exactly the finer ones this list deliberately omits.)
 */
export const QUICK_PICK_MARKETS: readonly QuickPickMarket[] = [
  { name: "Toronto", lat: 43.6532, lng: -79.3832, zoom: 11 },
  { name: "Ottawa", lat: 45.4215, lng: -75.6972, zoom: 11 },
  { name: "Mississauga", lat: 43.5853, lng: -79.645, zoom: 11.5 },
  { name: "Brampton", lat: 43.6882, lng: -79.763, zoom: 11.5 },
  { name: "Vaughan", lat: 43.8361, lng: -79.4983, zoom: 11.5 },
  { name: "Markham", lat: 43.8599, lng: -79.335, zoom: 11.5 },
  { name: "Oakville", lat: 43.4675, lng: -79.6877, zoom: 12 },
  { name: "Hamilton", lat: 43.2557, lng: -79.8711, zoom: 11.5 },
  // Added 2026-08-20 from the live City facet rolled up through CITY_GROUPS, cross-checked
  // against what users actually save in dashboard_prefs. London was the 6th-largest market
  // (2,165 for-sale) with no chip at all — its CITY_GROUPS entry exists precisely so the
  // bare name resolves, and nothing offered it. Richmond Hill was the only top-10 market
  // missing. Burlington had MORE real saves (3) than Ottawa or Hamilton, which were already
  // here. Cameras are the median coordinate of each market's live for-sale listings, not the
  // municipal centroid: Burlington's inventory sits ~4 km north of its centre (the south
  // edge is lakeshore), so the centroid framed half a map of water.
  { name: "London", lat: 42.9828, lng: -81.2494, zoom: 11.5 },
  { name: "Richmond Hill", lat: 43.8764, lng: -79.4381, zoom: 12 },
  { name: "Burlington", lat: 43.3636, lng: -79.8075, zoom: 12 },
];

/** Camera for a market name, or null if it isn't one of the quick picks. */
export function marketCamera(name: string): QuickPickMarket | null {
  const key = name.trim().toLowerCase();
  return QUICK_PICK_MARKETS.find((m) => m.name.toLowerCase() === key) ?? null;
}

/** Where to point the map for a saved region. */
export interface RegionCamera {
  lat: number;
  lng: number;
  zoom: number;
}

/**
 * Zoom for a community-scale centroid. Looser than the neighbourhood rows in
 * NeighbourhoodLeaderboard (z=14, a few streets) and tighter than a whole metro
 * (z=11), so a suburb like Barrhaven or Kanata frames roughly whole.
 */
const COMMUNITY_ZOOM = 12.5;

interface CityCentroid {
  city: string;
  lat: number;
  lng: number;
}

const CITY_CENTROIDS = cityCentroidsData as readonly CityCentroid[];

/**
 * Camera for ANY saved region — the quick-pick metros first, then the finer
 * city-centroids table.
 *
 * This exists because `marketCamera` alone answers null for everything outside the eight
 * quick picks, and every caller's fallback for null was `setLocation(region)` — a
 * Typesense TEXT query that pins the whole terminal to that place. So a user whose saved
 * area was community-scale (Barrhaven, Kanata, a Toronto district) had the map open
 * filtered, every listing outside the place hidden, on EVERY page load. Reported for
 * Vaughan on 2026-07-28 and fixed only for the quick picks; Barrhaven kept reproducing it
 * because community-scale names never had a camera to fall back to.
 *
 * data/city-centroids.json turns out to be exactly the right second source: it is keyed
 * by raw feed City strings, so its 34 entries are the finer/odd names QUICK_PICK_MARKETS
 * deliberately omits (Barrhaven, Kanata, the Toronto district codes). The two lists are
 * near-complements, which is why the quick-pick list's own note calls that file unusable —
 * true for whole-metro names, backwards here.
 *
 * Still returns null for a region in neither list. Callers keep their place-filter
 * fallback for that case: a wrong camera is worse than a filter the user can now see and
 * clear (LocationBoundsNotice names the action).
 */
export function regionCamera(name: string): RegionCamera | null {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return null;

  const pick = QUICK_PICK_MARKETS.find((m) => m.name.toLowerCase() === key);
  if (pick) return { lat: pick.lat, lng: pick.lng, zoom: pick.zoom };

  const centroid = CITY_CENTROIDS.find((c) => c.city.trim().toLowerCase() === key);
  if (!centroid) return null;
  // Guard the data file rather than trust it: a null/0,0 row would fly the map to the
  // Gulf of Guinea, which reads as a broken app rather than a missing centroid.
  const { lat, lng } = centroid;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng, zoom: COMMUNITY_ZOOM };
}

/**
 * Map href for a saved region: a CAMERA when we can place it, else the legacy place
 * filter. Shared so the dashboard's several "open this area on the map" links can't
 * drift apart again — they were all hand-rolling `?city=`, which is the filter form.
 */
export function regionMapHref(name: string): string {
  const cam = regionCamera(name);
  return cam
    ? `/properties?lat=${cam.lat.toFixed(6)}&lng=${cam.lng.toFixed(6)}&z=${cam.zoom}`
    : `/properties?city=${encodeURIComponent(name)}`;
}

/**
 * Is this region a WHOLE CITY (as opposed to a community / neighbourhood)? True for a
 * CITY_GROUPS parent (Toronto/London/Ottawa — the multi-district giants) or one of the
 * launch-city QUICK_PICK_MARKETS. A finer place typed via search (Woodbridge, Kanata,
 * Barrhaven) is community-scale and returns false. Name-only heuristic — no Typesense probe.
 */
export function isWholeCityRegion(name: string): boolean {
  const lower = (name ?? "").trim().toLowerCase();
  if (!lower) return false;
  if (Object.keys(CITY_GROUPS).some((p) => p.toLowerCase() === lower)) return true;
  return QUICK_PICK_MARKETS.some((m) => m.name.toLowerCase() === lower);
}

/**
 * Default new-listing-alert scope when an area is added (engagement build plan §176).
 * Adding an area turns alerts ON by default, tiered by breadth to protect deliverability:
 *   • a WHOLE CITY → 'filtered' ("My filters only" — never a city-wide firehose)
 *   • a COMMUNITY / neighbourhood / drawn area → 'all' (every new listing; manageable volume)
 */
export function defaultAlertScopeForRegion(name: string): "all" | "filtered" {
  return isWholeCityRegion(name) ? "filtered" : "all";
}

/**
 * Typesense filter fragment to AND-join into rawFilterBy. Backtick-quoted
 * string values so names with spaces / hyphens parse safely; backticks inside
 * the value are stripped (defensive, no legitimate City/CityRegion/schoolKey
 * contains one). Grouped parents (Toronto/London/Ottawa) expand to their whole City-group
 * so the dashboard scopes the full city, not a single stray listing.
 */
export function areaFilter(area: Area): string {
  if (area.kind === "region") {
    const safe = area.name.replace(/`/g, "");
    const group = CITY_GROUPS[safe];
    if (group) {
      // IN form (City:=[`a`, `b`, …]) is ONE Typesense filter operation. The OR form (one
      // op per member + per ||) blows the 100-op `filter_by` ceiling for large groups
      // (Ottawa = 51 areas). Group members are City values, so no CityRegion clause needed.
      return `City:=[${group.map((c) => `\`${c}\``).join(", ")}]`;
    }
    const community = COMMUNITY_ALIASES[safe];
    if (community) {
      // Umbrella community (e.g. Woodbridge) → its real CityRegion members. IN form = one
      // filter op. Members are CityRegion values under a parent city, so no City clause.
      return `CityRegion:=[${community.map((c) => `\`${c}\``).join(", ")}]`;
    }
    return `(City:=\`${safe}\` || CityRegion:=\`${safe}\`)`;
  }
  if (area.kind === "school") {
    const safe = area.schoolKey.replace(/`/g, "");
    return `NearbySchools:=\`${safe}\``;
  }
  // polygon: "lat, lng, lat, lng, ..." — Typesense `location:(...)` spec.
  const coords = area.polygon.map(([lat, lng]) => `${lat}, ${lng}`).join(", ");
  return `location:(${coords})`;
}

/** Display string used as a section heading / log breadcrumb. */
export function areaLabel(area: Area): string {
  return area.kind === "region" ? area.name : area.label;
}

/**
 * Stable string identity for an area — safe as a React `key`, a useEffect
 * dependency, or a cache key. Bubbles are id-keyed so renames don't invalidate.
 */
export function areaKey(area: Area): string {
  return area.kind === "region" ? `region:${area.name}` : `${area.kind}:${area.key}`;
}

/** Convenience: wrap a region string. */
export function regionArea(name: string): Area {
  return { kind: "region", name };
}

/**
 * Convert a saved Bubble into an Area. Draw and commute bubbles both become
 * `polygon` (their polygons are stored identically — only the source metadata
 * differs). School bubbles use the NearbySchools membership filter, which is
 * what the live SchoolFilter on /properties already uses — exact match against
 * the ETL-precomputed 2.5 km catchment, not the synthesized circle polygon.
 */
export function bubbleToArea(b: Bubble): Area {
  if (b.area_type === "school" && b.source.kind === "school") {
    return {
      kind: "school",
      key: b.id,
      label: b.name,
      schoolKey: b.source.schoolKey,
      polygon: b.polygon,
    };
  }
  return {
    kind: "polygon",
    key: b.id,
    label: b.name,
    polygon: b.polygon,
  };
}
