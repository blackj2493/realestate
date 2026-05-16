/**
 * AVM Audit Service
 * 
 * Fetches the R² score from the audit report table to determine
 * which engine mode to use (Two-Tier Rule).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export async function fetchR2Score(
  supabase: SupabaseClient,
  cityRegion: string,
  propertySubType: string
): Promise<number | null> {
  // Normalize to lowercase for case-insensitive matching
  const regionKey = cityRegion.toLowerCase().trim();
  const typeKey = propertySubType.toLowerCase().trim();

  const { data, error } = await supabase
    .from('avm_audit_report')
    .select('model_accuracy_score')
    .ilike('city_region', regionKey)
    .ilike('property_sub_type', typeKey)
    .single();

  if (error || !data) {
    // Decision #12: Fail silently
    console.warn(`[AVM] R² lookup failed for ${cityRegion}/${propertySubType}`);
    return null;
  }

  return data.model_accuracy_score;
}