/**
 * AVM Audit Service
 *
 * Fetches the model accuracy (R²) — which gates the engine mode — and the
 * Base_Price (fallback anchor used when there are no recent comps).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditInfo {
  r2: number | null;
  basePrice: number | null;
}

export async function fetchAuditInfo(
  supabase: SupabaseClient,
  cityRegion: string,
  propertySubType: string
): Promise<AuditInfo> {
  const regionKey = cityRegion.toLowerCase().trim();
  const typeKey = propertySubType.toLowerCase().trim();

  const { data, error } = await supabase
    .from('avm_audit_report')
    .select('model_accuracy_score, base_price')
    .ilike('city_region', regionKey)
    .ilike('property_sub_type', typeKey)
    .maybeSingle();

  if (error || !data) {
    console.warn(`[AVM] Audit lookup failed for ${cityRegion}/${propertySubType}`);
    return { r2: null, basePrice: null };
  }

  const basePrice =
    typeof data.base_price === 'number' && data.base_price > 0 ? data.base_price : null;
  return { r2: data.model_accuracy_score ?? null, basePrice };
}
