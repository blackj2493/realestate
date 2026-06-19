/**
 * Ratio-Price Calculator Service
 * Phase 3: resolves the PURCHASE-PRICE BASIS used for the financial RATIO metrics
 * (Cap Rate / Gross Yield / Tax Burden) — NOT a valuation. For a normal listing this is
 * simply the list price; it only substitutes a city-region average to defeat "$1 bidding
 * war" edge cases (sub-$200K freehold asks) that would otherwise produce absurd cap rates.
 *
 * NOTE: this is deliberately NOT the AVM / "True Value" (src/lib/avm) — it is the price you
 * divide rent/tax by. Renamed from the old `trueValueCalculator` to avoid colliding with the
 * AVM-based "True Value"/comparable-value concept shown on the listing page.
 *
 * Fetches city_region_avg_price and municipal_mill_rates from Supabase.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface RatioPriceResult {
  /** Price the ratio metrics divide by: list price, or city-region avg for $1 listings. */
  calculation_price: number;
  /** True when we substituted a city-region average (the list price was an outlier). */
  is_price_discovery: boolean;
}

/**
 * Resolve the ratio-price basis. Defeats $1 bidding-war listings for Cap Rate / Yield /
 * Tax Burden: when ListPrice < $200K + Detached/Semi-Detached, fall back to
 * city_region_avg_price; otherwise the list price is the basis.
 */
export async function resolveRatioPrice(params: {
  listPrice: number;
  propertySubType: string;
  cityRegion: string;
}): Promise<RatioPriceResult> {
  const { listPrice, propertySubType, cityRegion } = params;
  const isFreehold = !['Condo Apt', 'Condo Townhouse'].includes(propertySubType);
  const isLowPrice = listPrice < 200000 && isFreehold && ['Detached', 'Semi-Detached'].includes(propertySubType);

  if (isLowPrice) {
    // Fetch city_region_avg_price
    const { data } = await supabase
      .from('city_region_avg_price')
      .select('avg_sale_price')
      .eq('city_region', cityRegion)
      .single();

    const fallbackPrice = data?.avg_sale_price || listPrice;
    return {
      calculation_price: fallbackPrice,
      is_price_discovery: true,
    };
  }

  return {
    calculation_price: listPrice,
    is_price_discovery: false,
  };
}

export interface MillRateResult {
  base_mill_rate: number;
  city: string;
}

/**
 * Fetch municipal mill rate for a city region.
 * Falls back to 0.0095 (~0.95%) if not found.
 */
export async function fetchMillRate(cityRegion: string): Promise<MillRateResult> {
  const city = cityRegion.split(' ')[0];

  const { data } = await supabase
    .from('municipal_mill_rates')
    .select('base_mill_rate, city')
    .eq('city', city)
    .single();

  return {
    base_mill_rate: data?.base_mill_rate || 0.0095,
    city: data?.city || city,
  };
}

export default { resolveRatioPrice, fetchMillRate };
