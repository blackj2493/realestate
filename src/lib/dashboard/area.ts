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
 * /welcome first-run seed and the dashboard's FirstRunRegionPicker. Every name must
 * resolve to real inventory through areaFilter above, so "Toronto" and "Ottawa" are
 * GROUPS (TRREB has no single City value for either) that expand to their whole
 * City-group. Anything finer (Orleans, Kanata) is reached via location search, not here.
 * Keep this list short — it is a starting point the user edits later, not a taxonomy.
 *
 * The coordinates exist because a first-run user is EXPLORING, not searching. Seeding
 * them with a city text filter pins the terminal to that city, and panning one street
 * past the boundary empties the map with no explanation. Seeding the CAMERA instead
 * leaves the query unfiltered, so results follow the viewport and panning just works.
 * The city filter is the right model only when the user deliberately typed a place.
 *
 * data/city-centroids.json is NOT usable here — it is keyed by raw TRREB City strings
 * (it has "Toronto C01" but no "Toronto") and covers only 34 geocoding fallbacks. These
 * are hand-set, cross-checked against that file for the four it does contain, with zoom
 * chosen per market so a dense core and a spread-out suburb both frame sensibly.
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
];

/** Camera for a market name, or null if it isn't one of the quick picks. */
export function marketCamera(name: string): QuickPickMarket | null {
  const key = name.trim().toLowerCase();
  return QUICK_PICK_MARKETS.find((m) => m.name.toLowerCase() === key) ?? null;
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
