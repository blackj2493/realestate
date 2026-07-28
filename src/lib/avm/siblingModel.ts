/**
 * Sibling-cohort coefficient borrow for UNTRAINED communities.
 *
 * A thin community (e.g. "Aurora Estates") has no trained matrix. Rather than
 * price it with zero feature adjustment, borrow the elasticities of the best
 * trained SIBLING in the same municipality + property type (e.g. "Aurora
 * Highlands" Detached). Deterministic, no AI (CLAUDE.md §4).
 *
 * Grain note: there is no city/region matrix today (see avm-model-pipeline-facts);
 * this borrows a real community model from a neighbouring community. Phase B
 * replaces it with true city-grain models.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCoefficients, type CoefficientRow } from './matrixService';
import { rawVariantsOf } from './normalizeType';
import { COEFFICIENT_ENGINE_THRESHOLD } from './types';

const SIBLING_MIN_N = 30;

export interface SiblingModel {
  coefficients: CoefficientRow[];
  r2: number;
  n: number;
  siblingCityRegion: string;
}

/** Pure: pick the sibling with the most sales (tie-break highest R²), gated. */
export function pickSibling(
  rows: { city_region: string; model_accuracy_score: number | null; total_sales_analyzed: number | null }[]
): { city_region: string; r2: number; n: number } | null {
  const eligible = rows
    .map((r) => ({ city_region: r.city_region, r2: r.model_accuracy_score ?? 0, n: r.total_sales_analyzed ?? 0 }))
    .filter((r) => r.r2 >= COEFFICIENT_ENGINE_THRESHOLD && r.n >= SIBLING_MIN_N);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => (b.n - a.n) || (b.r2 - a.r2));
  return eligible[0];
}

/**
 * Find a trained sibling model for an untrained (city, subType). Returns null when
 * the subject has no city, no sibling cohorts, or none clear the R²/n gate.
 */
export async function fetchSiblingModel(
  supabase: SupabaseClient,
  city: string | null,
  propertySubType: string,
  rawPropertySubType: string
): Promise<SiblingModel | null> {
  if (!city) return null;
  const subVariants = rawVariantsOf(propertySubType, rawPropertySubType);
  if (subVariants.length === 0) return null;

  // 1. Which community cohorts live in this municipality? (raw_vow_sold carries both.)
  //    Single DISTINCT via RPC (migration 099). This replaced a 20 x 1,000-row paged
  //    loop that existed only because PostgREST hard-caps responses at 1,000 rows
  //    (audit MEDIUM-9) — it cost up to 20 round-trips and 20,000 transferred rows to
  //    produce the ~30-50 distinct values we actually want, and still truncated silently
  //    past 20 pages. The RPC also drops the ILIKE filter that made every one of those
  //    pages seq-scan ~289k rows (43,023 calls @ 166 ms over 4.2d).
  const { data: regionRows, error: regionErr } = await supabase.rpc('sold_city_regions', {
    p_city: city.trim(),
    p_sub_types: subVariants,
  });
  if (regionErr || !regionRows) return null;
  const cityRegions = (regionRows as { city_region: string }[]).map((r) => r.city_region);
  if (cityRegions.length === 0) return null;

  // 2. Which of those are trained? Pick the best.
  const auditRes = await supabase
    .from('avm_audit_report')
    .select('city_region, model_accuracy_score, total_sales_analyzed')
    .in('city_region', cityRegions)
    .ilike('property_sub_type', propertySubType.toLowerCase().trim());
  const best = pickSibling(auditRes.data ?? []);
  if (!best) return null;

  // 3. Pull the sibling's coefficients.
  const coefficients = await fetchCoefficients(supabase, best.city_region, propertySubType);
  if (coefficients.length === 0) return null;

  return { coefficients, r2: best.r2, n: best.n, siblingCityRegion: best.city_region };
}
