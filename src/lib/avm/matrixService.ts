/**
 * AVM Matrix Service
 * 
 * Fetches all per-unit coefficients for a given market and property type.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CoefficientRow {
  featureName: string;
  multiplier: number;
  dollarPerUnit: number;
}

export async function fetchCoefficients(
  supabase: SupabaseClient,
  cityRegion: string,
  propertySubType: string
): Promise<CoefficientRow[]> {
  // Normalize to lowercase for case-insensitive matching
  const regionKey = cityRegion.toLowerCase().trim();
  const typeKey = propertySubType.toLowerCase().trim();

  const { data, error } = await supabase
    .from('avm_multiplier_matrix')
    .select('feature_name, multiplier, dollar_per_unit')
    .ilike('city_region', regionKey)
    .ilike('property_sub_type', typeKey);

  if (error || !data) {
    console.warn(`[AVM] Coefficient lookup failed for ${cityRegion}/${propertySubType}`);
    return [];
  }

  return data.map((row) => ({
    featureName: row.feature_name,
    multiplier: row.multiplier,
    dollarPerUnit: row.dollar_per_unit,
  }));
}