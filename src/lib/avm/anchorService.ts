/**
 * AVM Anchor Service
 *
 * Computes the live 90-day anchor from raw_vow_sold for a market. The sold table
 * stores verbatim TRREB spellings, so we pool the raw variants of the normalized
 * type (rawVariantsOf) to match the model's training group. Uses the MEDIAN close
 * price (robust to a single luxury outlier; ≈ the geometric mean that an
 * exp(log-space) model implies). Returns the comp count so the caller can fall
 * back to Base_Price when the window is too thin.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rawVariantsOf } from './normalizeType';

export interface AnchorResult {
  anchor: number | null;
  comps: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function fetchAnchor(
  supabase: SupabaseClient,
  cityRegion: string,
  normalizedType: string,
  rawType: string
): Promise<AnchorResult> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const regionKey = cityRegion.toLowerCase().trim();
  const variants = rawVariantsOf(normalizedType, rawType);
  if (variants.length === 0) return { anchor: null, comps: 0 };

  const { data, error } = await supabase
    .from('raw_vow_sold')
    .select('close_price')
    .ilike('city_region', regionKey)
    .in('property_sub_type', variants)
    .gt('close_price', 0)
    .gte('close_date', ninetyDaysAgo.toISOString());

  if (error || !data || data.length === 0) {
    console.warn(`[AVM] Anchor lookup empty for ${cityRegion}/${normalizedType}`);
    return { anchor: null, comps: 0 };
  }

  const prices = data
    .map((row) => Number(row.close_price))
    .filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length === 0) return { anchor: null, comps: 0 };

  return { anchor: Math.round(median(prices)), comps: prices.length };
}
