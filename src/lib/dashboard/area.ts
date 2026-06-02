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
 * Typesense filter fragment to AND-join into rawFilterBy. Backtick-quoted
 * string values so names with spaces / hyphens parse safely; backticks inside
 * the value are stripped (defensive, no legitimate City/CityRegion/schoolKey
 * contains one).
 */
export function areaFilter(area: Area): string {
  if (area.kind === "region") {
    const safe = area.name.replace(/`/g, "");
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
