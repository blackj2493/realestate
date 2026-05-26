/**
 * AVM Matrix Service
 *
 * Fetches the per-feature standardized coefficients (beta, mean, std) for a given
 * market + normalized property type. Like auditService, handles the verbatim
 * vs. clean `city_region` mismatch via candidate-key lookup (see
 * normalizeType.cityRegionLookupCandidates).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cityRegionLookupCandidates } from './normalizeType';

export interface CoefficientRow {
  featureName: string;
  beta: number;
  mean: number;
  std: number;
}

export async function fetchCoefficients(
  supabase: SupabaseClient,
  cityRegion: string,
  propertySubType: string
): Promise<CoefficientRow[]> {
  const candidates = cityRegionLookupCandidates(cityRegion);
  if (candidates.length === 0) return [];
  const typeKey = propertySubType.toLowerCase().trim();

  const { data, error } = await supabase
    .from('avm_multiplier_matrix')
    .select('city_region, feature_name, beta, feat_mean, feat_std')
    .in('city_region', candidates)
    .ilike('property_sub_type', typeKey);

  if (error || !data || data.length === 0) {
    console.warn(`[AVM] Coefficient lookup failed for ${cityRegion}/${propertySubType}`);
    return [];
  }

  // If multiple candidates matched (e.g. both "Bronte" and "1001 - BR Bronte"
  // exist as separate cohorts), keep only the rows from the highest-priority
  // candidate so the feature set is internally consistent.
  const order = new Map(candidates.map((c, i) => [c, i]));
  const bestPriority = Math.min(...data.map((r) => order.get(r.city_region) ?? 999));
  const chosen = data.filter((r) => (order.get(r.city_region) ?? 999) === bestPriority);

  return chosen.map((row) => ({
    featureName: row.feature_name,
    beta: row.beta,
    mean: row.feat_mean,
    std: row.feat_std,
  }));
}
