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
 * COHORT LADDER. fetchCohortAudit returns every rung's audit row, labelled, in the
 * order the matrix lookup uses (matrixService.fetchCohortCoefficients). r2 gates the
 * coefficient engine and — with n — whether a coarse rung may be used at all, so
 * resolveModel reads the audit of exactly the rung whose coefficients it takes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { describeRungs } from './matrixService';
import { cohortRungLookupKeys, type CohortRung, type CohortRungLookupKey } from './normalizeType';

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
}

/** One rung's audit row. */
export interface CohortAudit extends AuditInfo {
  rung: CohortRung;
}

export const NO_AUDIT: AuditInfo = { r2: null, basePrice: null, n: null };

/** Community rung only — the trained-cohort form. For the full ladder use fetchCohortAudit. */
export async function fetchAuditInfo(
  supabase: SupabaseClient,
  cityRegion: string,
  propertySubType: string
): Promise<AuditInfo> {
  const found = await fetchCohortAudit(
    supabase,
    cohortRungLookupKeys(cityRegion, null, null),
    propertySubType
  );
  const first = found[0];
  return first ? { r2: first.r2, basePrice: first.basePrice, n: first.n } : NO_AUDIT;
}

/**
 * Every rung in `rungs` that has an audit row for this sub-type, in the order given
 * (finest first). 96 (city_region, sub-type) pairs exist at BOTH a community and a city
 * rung — "Aylmer" the community and "Aylmer" the city — so the rung is re-applied in
 * memory and never left to the row order.
 */
export async function fetchCohortAudit(
  supabase: SupabaseClient,
  rungs: CohortRungLookupKey[],
  propertySubType: string
): Promise<CohortAudit[]> {
  if (rungs.length === 0) return [];
  const typeKey = propertySubType.toLowerCase().trim();

  const { data, error } = await supabase
    .from(AUDIT_TABLE)
    .select('cohort_rung, city_region, model_accuracy_score, base_price, total_sales_analyzed')
    .in('cohort_rung', rungs.map((r) => r.rung))
    .in('city_region', [...new Set(rungs.flatMap((r) => r.keys))])
    .ilike('property_sub_type', typeKey);

  if (error || !data || data.length === 0) {
    console.warn(`[AVM] Audit lookup failed for ${describeRungs(rungs)}/${propertySubType}`);
    return [];
  }

  const out: CohortAudit[] = [];
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
    out.push({ rung, r2: best.model_accuracy_score ?? null, basePrice, n });
  }
  return out;
}
