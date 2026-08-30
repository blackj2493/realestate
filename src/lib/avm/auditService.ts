/**
 * AVM Audit Service
 *
 * Fetches the model accuracy (R²) — which gates the engine mode — and the
 * Base_Price (fallback anchor used when there are no recent comps).
 *
 * The `avm_audit_report.city_region` column is stored verbatim from the source
 * CSVs, which MIX clean spellings ("Brampton East", "Bedford Park-Nortown")
 * with legacy prefixed forms ("1001 - BR Bronte", "3104 - CFB Rockcliffe and
 * Area"). Live listings carry the clean TRREB CityRegion, so prefixed cohorts
 * would silently miss on a case-insensitive `.eq`. We try every candidate
 * spelling in one `.in()` round-trip and pick the highest-priority match;
 * see normalizeType.cityRegionLookupCandidates for the rationale.
 *
 * COHORT LADDER. This walks the same community → FSA → city ladder as the matrix
 * lookup, via the shared cohortRungLookupKeys. It has to: r2 gates the coefficient
 * engine, so coefficients found at the FSA rung with an r2 read from a community that
 * does not exist would leave the engine switched off and the ladder pointless.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cohortRungLookupKeys, type CohortRung } from './normalizeType';

// Champion/challenger: live reads the champion; offline backtests set AVM_AUDIT_TABLE to score
// the challenger in staging. Allowlisted so production can never repoint at arbitrary data.
const AUDIT_TABLE =
  process.env.AVM_AUDIT_TABLE === 'avm_audit_report_staging'
    ? 'avm_audit_report_staging'
    : 'avm_audit_report';

export interface AuditInfo {
  r2: number | null;
  basePrice: number | null;
  /** Cohort sample size (avm_audit_report.total_sales_analyzed); null if unknown. */
  n: number | null;
  /** Which rung answered; null when no rung had a cohort. Informational — resolveModel
   *  takes its verdict from the MATRIX lookup so the two can never disagree. */
  rung?: CohortRung | null;
}

const EMPTY: AuditInfo = { r2: null, basePrice: null, n: null, rung: null };

export async function fetchAuditInfo(
  supabase: SupabaseClient,
  cityRegion: string,
  propertySubType: string,
  /** Coarser keys to fall back to. Omit to search the community rung only. */
  ladder?: { postalCode?: string | null; city?: string | null }
): Promise<AuditInfo> {
  const rungs = cohortRungLookupKeys(cityRegion, ladder?.postalCode, ladder?.city);
  if (rungs.length === 0) return EMPTY;
  const typeKey = propertySubType.toLowerCase().trim();

  const { data, error } = await supabase
    .from(AUDIT_TABLE)
    .select('cohort_rung, city_region, model_accuracy_score, base_price, total_sales_analyzed')
    .in('cohort_rung', rungs.map((r) => r.rung))
    .in('city_region', [...new Set(rungs.flatMap((r) => r.keys))])
    .ilike('property_sub_type', typeKey);

  if (error || !data || data.length === 0) {
    console.warn(`[AVM] Audit lookup failed for ${cityRegion}/${propertySubType}`);
    return EMPTY;
  }

  for (const { rung, keys } of rungs) {
    const order = new Map(keys.map((k, i) => [k, i]));
    const inRung = data.filter((r) => r.cohort_rung === rung && order.has(r.city_region));
    if (inRung.length === 0) continue;

    // Highest-priority spelling wins (verbatim over stripped).
    const best = inRung.reduce((acc, row) =>
      (order.get(row.city_region) ?? 999) < (order.get(acc.city_region) ?? 999) ? row : acc
    );
    const basePrice =
      typeof best.base_price === 'number' && best.base_price > 0 ? best.base_price : null;
    const n = typeof best.total_sales_analyzed === 'number' ? best.total_sales_analyzed : null;
    return { r2: best.model_accuracy_score ?? null, basePrice, n, rung };
  }

  return EMPTY;
}
