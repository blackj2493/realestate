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
  //    Paged loop: PostgREST hard-caps at 1,000 rows per response; .limit(5000) was
  //    silently truncated to 1,000, dropping donor communities past row 1,000 in big
  //    cities and degrading untrained-cohort AVM. (audit MEDIUM-9)
  const PAGE = 1000;
  const communitySet = new Set<string>();
  for (let from = 0; from < PAGE * 20; from += PAGE) {
    const { data, error } = await supabase
      .from('raw_vow_sold')
      .select('city_region')
      .ilike('city', city.trim())
      .in('property_sub_type', subVariants)
      .order('city_region')
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data as { city_region: string }[]) {
      if (r.city_region) communitySet.add(r.city_region);
    }
    if (data.length < PAGE) break;
    if (from + PAGE >= PAGE * 20) {
      console.warn(
        `[siblingModel] IO-budget guard: stopped after 20 pages fetching city_regions for city="${city}". Some communities may be missing.`
      );
    }
  }
  const cityRegions = Array.from(communitySet);
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
