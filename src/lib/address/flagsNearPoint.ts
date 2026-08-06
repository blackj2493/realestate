/**
 * Point-radius "Things to Know" flags for the address-profile page
 * (ADDRESS_PROFILES_PLAN P3).
 *
 * The listing flow precomputes flags into `listing_geo_flags` (Disk-IO budget); an
 * arbitrary address has no precomputed row, so this runs one live PostGIS query via the
 * `flags_near_point` RPC (migration 078 — precedent: `zoning_in_bbox`, migration 050).
 * Acceptable here: profile pages are low-frequency long-tail hits and the result is
 * cached 24h per ~11m grid cell. Degrades to [] (section hidden) until the RPC is
 * applied in prod.
 *
 * The dataset registry (GEO_DATASETS) stays the single source of truth: kinds + radii
 * are passed to the RPC as jsonb specs; wording comes from each dataset's flag spec.
 * Deterministic — no LLM (CLAUDE.md §4).
 */
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { ACTIVE_DATASETS, describeFeature } from "@/lib/property/geoDatasets";
import type { DiligenceFlag } from "@/lib/property/diligence";

/** intersect predicates test at 0 m (inside → distance 0); distance predicates use their radius. */
const SPECS = ACTIVE_DATASETS.map((d) => ({
  kind: d.kind,
  meters: d.predicate.type === "distance" ? d.predicate.meters : 0,
}));

const byKind = new Map(ACTIVE_DATASETS.map((d) => [d.kind, d]));

export interface AddressFlag extends DiligenceFlag {
  distanceM: number;
}

/** null = the lookup itself failed (section should hide — we cannot claim "checked");
 *  [] = the query ran and found nothing. */
async function fetchFlags(lat: number, lng: number): Promise<AddressFlag[] | null> {
  try {
    const { data, error } = await getServiceRoleClient().rpc("flags_near_point", {
      in_lat: lat,
      in_lng: lng,
      in_specs: SPECS,
    });
    if (error || !Array.isArray(data)) {
      if (error) console.error("[flagsNearPoint] rpc failed (section hidden):", error.message);
      return null;
    }
    // One flag per dataset kind — the nearest feature wins (rows arrive distance-sorted).
    const out = new Map<string, AddressFlag>();
    for (const row of data as Array<{ kind: string; attrs: unknown; distance_m: number }>) {
      const ds = byKind.get(row.kind);
      if (!ds || out.has(row.kind)) continue;
      const distM = Math.max(0, Math.round(row.distance_m ?? 0));
      // Rows arrive distance-sorted and we keep the first per kind, so `attrs` here is the
      // NEAREST feature's — the right one to describe (e.g. "New building"). Non-descriptor
      // datasets / unrecognized values → null → generic title (unchanged).
      const descriptor = describeFeature(
        row.kind,
        row.attrs != null && typeof row.attrs === "object" ? (row.attrs as Record<string, unknown>) : null,
      );
      out.set(row.kind, {
        id: ds.flag.id,
        kind: ds.flag.kind,
        severity: ds.flag.severity,
        title: ds.flag.title(distM, descriptor ?? undefined),
        source: ds.flag.source,
        ask: ds.flag.ask,
        distanceM: distM,
      });
    }
    return [...out.values()].sort((a, b) => b.severity - a.severity);
  } catch (err) {
    console.error("[flagsNearPoint]", err);
    return null;
  }
}

/** 24h-cached per ~11m grid cell (4-decimal rounding) — repeat views are free. */
export async function getFlagsNearPoint(lat: number, lng: number): Promise<AddressFlag[] | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = unstable_cache(() => fetchFlags(lat, lng), ["address-flags", key], { revalidate: 86_400 });
  return cached();
}

/** Short labels of everything we checked — the "checked & clear" line. */
export const CHECKED_LABELS = ACTIVE_DATASETS.map((d) => d.shortLabel);
