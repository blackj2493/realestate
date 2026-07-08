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
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cityRegionLookupCandidates } from './normalizeType';

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

export async function fetchAuditInfo(
  supabase: SupabaseClient,
  cityRegion: string,
  propertySubType: string
): Promise<AuditInfo> {
  const candidates = cityRegionLookupCandidates(cityRegion);
  if (candidates.length === 0) return { r2: null, basePrice: null, n: null };
  const typeKey = propertySubType.toLowerCase().trim();

  const { data, error } = await supabase
    .from(AUDIT_TABLE)
    .select('city_region, model_accuracy_score, base_price, total_sales_analyzed')
    .in('city_region', candidates)
    .ilike('property_sub_type', typeKey)
    .limit(candidates.length);

  if (error || !data || data.length === 0) {
    console.warn(`[AVM] Audit lookup failed for ${cityRegion}/${propertySubType}`);
    return { r2: null, basePrice: null, n: null };
  }

  // Pick the row matching the highest-priority candidate (verbatim wins over stripped).
  const order = new Map(candidates.map((c, i) => [c, i]));
  const best = data.reduce((acc, row) =>
    (order.get(row.city_region) ?? 999) < (order.get(acc.city_region) ?? 999) ? row : acc
  );

  const basePrice =
    typeof best.base_price === 'number' && best.base_price > 0 ? best.base_price : null;
  const n = typeof best.total_sales_analyzed === 'number' ? best.total_sales_analyzed : null;
  return { r2: best.model_accuracy_score ?? null, basePrice, n };
}
