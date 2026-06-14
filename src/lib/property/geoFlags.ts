/**
 * geoFlagsFor — deterministic mapping from spatial-join results to DiligenceFlag[].
 *
 * Phase 2 of "Things to Know": NON-MLS public-records facts (flood/rail/traffic)
 * geo-joined by each listing's coordinates. This module is the PURE boundary —
 * enrichGeoFlags.ts runs the PostGIS predicates and hands the raw measurements
 * here, so the wording/severity stay consistent with the Phase-1 voice in
 * diligence.ts and the mapping is trivially unit-testable.
 *
 * COMPLIANCE (CLAUDE.md §4): no LLM. The inputs are produced by spatial SQL
 * (ST_Intersects / ST_DWithin) over PUBLIC datasets; this is a hardcoded,
 * deterministic transform. Each flag carries an attributable `source`.
 *
 * Output feeds buildDiligenceFlags(payload, external) on the page as `external`.
 */

import type { DiligenceFlag } from "@/lib/property/diligence";

/** Distance to the nearest rail corridor (m) at/under which we warn. */
export const RAIL_PROXIMITY_M = 150;
/** AADT at/above which a fronting road counts as "busy". */
export const BUSY_ROAD_AADT = 8000;

/**
 * One listing's spatial-join measurements. All optional so the enrichment can
 * ship predicates incrementally (flood first; rail/traffic as follow-ups) — an
 * absent/null field simply yields no flag.
 */
export interface GeoFlagInput {
  /** Listing point falls inside a regulated floodplain polygon (ST_Intersects). */
  in_flood?: boolean | null;
  /** Metres to the nearest rail corridor (MIN ST_Distance::geography); null = none nearby. */
  rail_m?: number | null;
  /** AADT of the nearest traffic count within the threshold (MAX); null = none nearby. */
  near_aadt?: number | null;
}

/**
 * Map spatial measurements → diligence flags. Pure: same input always yields the
 * same flags. Sorting/merging with payload flags happens in buildDiligenceFlags.
 */
export function geoFlagsFor(row: GeoFlagInput): DiligenceFlag[] {
  const out: DiligenceFlag[] = [];

  if (row.in_flood === true) {
    out.push({
      id: "flood",
      kind: "warn",
      severity: 70,
      title: "Within a regulated floodplain",
      source: "TRCA floodplain mapping",
      ask: "Confirm flood insurance availability and whether a TRCA development permit is required.",
    });
  }

  if (row.rail_m != null && Number.isFinite(row.rail_m) && row.rail_m < RAIL_PROXIMITY_M) {
    out.push({
      id: "rail",
      kind: "warn",
      severity: 40,
      title: `${Math.round(row.rail_m)} m from a rail corridor`,
      source: "Metrolinx / OSM rail GIS",
      ask: "Check noise and vibration at peak hours before you commit.",
    });
  }

  if (row.near_aadt != null && Number.isFinite(row.near_aadt) && row.near_aadt >= BUSY_ROAD_AADT) {
    out.push({
      id: "traffic",
      kind: "warn",
      severity: 38,
      title: `Fronts a busy road (~${Math.round(row.near_aadt).toLocaleString()} vehicles/day)`,
      source: "City traffic counts (AADT)",
      ask: "Visit at rush hour to gauge noise and access.",
    });
  }

  return out;
}
