/**
 * AVM Anchor Service
 * 
 * Fetches the 90-day average close price from raw_vow_sold.
 * This calculates on-the-fly — no pre-stored anchor table needed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export async function fetchAnchorPrice(
  supabase: SupabaseClient,
  cityRegion: string,
  propertySubType: string
): Promise<number | null> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Normalize to lowercase for case-insensitive matching
  const regionKey = cityRegion.toLowerCase().trim();
  const typeKey = propertySubType.toLowerCase().trim();

  const { data, error } = await supabase
    .from('raw_vow_sold')
    .select('close_price')
    .ilike('city_region', regionKey)
    .ilike('property_sub_type', typeKey)
    .gte('close_date', ninetyDaysAgo.toISOString());

  if (error || !data || data.length === 0) {
    // Decision #12: Fail silently, return null
    console.warn(`[AVM] Anchor price lookup failed for ${cityRegion}/${propertySubType}`);
    return null;
  }

  const avg = data.reduce((sum, row) => sum + (row.close_price ?? 0), 0) / data.length;
  return Math.round(avg);
}