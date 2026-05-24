/**
 * AVM Matrix Service
 *
 * Fetches the per-feature standardized coefficients (beta, mean, std) for a given
 * market + normalized property type.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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
  const regionKey = cityRegion.toLowerCase().trim();
  const typeKey = propertySubType.toLowerCase().trim();

  const { data, error } = await supabase
    .from('avm_multiplier_matrix')
    .select('feature_name, beta, feat_mean, feat_std')
    .ilike('city_region', regionKey)
    .ilike('property_sub_type', typeKey);

  if (error || !data) {
    console.warn(`[AVM] Coefficient lookup failed for ${cityRegion}/${propertySubType}`);
    return [];
  }

  return data.map((row) => ({
    featureName: row.feature_name,
    beta: row.beta,
    mean: row.feat_mean,
    std: row.feat_std,
  }));
}
