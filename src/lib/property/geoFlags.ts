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
 *   - attrs[kind]     : that nearest feature's raw source properties, for datasets that
 *                       declare a `detail` normalizer (major_construction → permit scale,
 *                       cost, issue date). Absent → the flag renders without its sub-line.
 * All optional so the enrichment can ship/skip predicates incrementally — an absent
 * signal simply yields no flag.
 */
export interface GeoSignals {
  inside?: Record<string, boolean | null | undefined>;
  distanceM?: Record<string, number | null | undefined>;
  attrs?: Record<string, unknown>;
}

/**
 * Map spatial signals → diligence flags via the dataset registry. Pure: the same
 * input always yields the same flags. Sorting/merging with payload flags happens in
 * buildDiligenceFlags.
 */
export function geoFlagsFor(sig: GeoSignals): DiligenceFlag[] {
  const inside = sig.inside ?? {};
  const distanceM = sig.distanceM ?? {};
  const attrs = sig.attrs ?? {};
  const out: DiligenceFlag[] = [];

  for (const ds of ACTIVE_DATASETS) {
    if (ds.predicate.type === "intersect") {
      if (inside[ds.kind] === true) out.push(buildGeoFlag(ds, 0, attrs[ds.kind]));
    } else {
      const m = distanceM[ds.kind];
      // The enrichment already applies ST_DWithin(meters); re-guard defensively so a
      // stray out-of-range value can't produce a flag.
      if (m != null && Number.isFinite(m) && m <= ds.predicate.meters) {
        out.push(buildGeoFlag(ds, m, attrs[ds.kind]));
      }
    }
  }

  return out;
}

/**
 * Merge ONE dataset's freshly-recomputed flag into a listing's existing geo-flag array,
 * leaving every OTHER dataset's flag untouched, and re-emit the whole array in registry
 * order — byte-identical to a full geoFlagsFor() recompute in which only `kind`'s geometry
 * changed. `newFlag` is the recomputed flag (already asOf-stamped) when the listing now
 * matches, or null to CLEAR it. This is what lets the single-dataset targeted refresh
 * (enrichGeoFlags --dataset) update just e.g. dev_application weekly without re-running the
 * other 10 predicates (which would need the full-payload re-scan the weekly job must avoid).
 *
 * Any stored flag whose id is no longer an ACTIVE dataset is dropped — the same outcome a
 * full recompute produces once a dataset is disabled.
 */
export function mergeDatasetFlag(
  existing: DiligenceFlag[],
  kind: string,
  newFlag: DiligenceFlag | null,
): DiligenceFlag[] {
  const byId = new Map<string, DiligenceFlag>();
  for (const f of existing) if (f && f.id !== kind) byId.set(f.id, f);

  const out: DiligenceFlag[] = [];
  for (const ds of ACTIVE_DATASETS) {
    const id = ds.flag.id;
    if (id === kind) {
      if (newFlag) out.push(newFlag);
    } else {
      const f = byId.get(id);
      if (f) out.push(f);
    }
  }
  return out;
}
