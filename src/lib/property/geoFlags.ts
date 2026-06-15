/**
 * geoFlagsFor — deterministic mapping from spatial-join signals to DiligenceFlag[].
 *
 * Phase 2 of "Things to Know": NON-MLS public-records facts geo-joined by each
 * listing's coordinates. This module is the PURE boundary — enrichGeoFlags.ts runs
 * the PostGIS predicates (driven by the geoDatasets registry) and hands the raw
 * signals here, so wording/severity stay consistent and the mapping is trivially
 * unit-testable.
 *
 * COMPLIANCE (CLAUDE.md §4): no LLM. Inputs are produced by spatial SQL
 * (ST_Intersects / ST_DWithin) over PUBLIC datasets; this is a hardcoded,
 * deterministic transform. Output feeds buildDiligenceFlags(payload, external).
 */

import type { DiligenceFlag } from "@/lib/property/diligence";
import { ACTIVE_DATASETS, buildGeoFlag } from "@/lib/property/geoDatasets";

/**
 * One listing's spatial-join measurements, keyed by dataset `kind`:
 *   - inside[kind]    : the point intersects this dataset's geometry (polygon flags)
 *   - distanceM[kind] : metres to the nearest feature WITHIN the dataset's threshold,
 *                       or null/absent when none is near (distance flags)
 * All optional so the enrichment can ship/skip predicates incrementally — an absent
 * signal simply yields no flag.
 */
export interface GeoSignals {
  inside?: Record<string, boolean | null | undefined>;
  distanceM?: Record<string, number | null | undefined>;
}

/**
 * Map spatial signals → diligence flags via the dataset registry. Pure: the same
 * input always yields the same flags. Sorting/merging with payload flags happens in
 * buildDiligenceFlags.
 */
export function geoFlagsFor(sig: GeoSignals): DiligenceFlag[] {
  const inside = sig.inside ?? {};
  const distanceM = sig.distanceM ?? {};
  const out: DiligenceFlag[] = [];

  for (const ds of ACTIVE_DATASETS) {
    if (ds.predicate.type === "intersect") {
      if (inside[ds.kind] === true) out.push(buildGeoFlag(ds, 0));
    } else {
      const m = distanceM[ds.kind];
      // The enrichment already applies ST_DWithin(meters); re-guard defensively so a
      // stray out-of-range value can't produce a flag.
      if (m != null && Number.isFinite(m) && m <= ds.predicate.meters) {
        out.push(buildGeoFlag(ds, m));
      }
    }
  }

  return out;
}
