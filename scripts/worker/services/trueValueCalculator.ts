/**
 * True Value Calculator Service
 * Phase 3: Defeats $1 bidding war edge cases for Cap Rate/Yield/Tax Burden
 * 
 * Fetches city_region_avg_price and municipal_mill_rates from Supabase.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface TrueValueResult {
  calculation_price: number;
  true_value: number;
  is_price_discovery: boolean;
}

/**
 * Defeats $1 bidding war listings for Cap Rate / Yield / Tax Burden calculations.
 * When ListPrice < $200K + Detached/Semi-Detached, fallback to city_region_avg_price.
 */
export async function fetchTrueValue(params: {
  listPrice: number;
  propertySubType: string;
  cityRegion: string;
}): Promise<TrueValueResult> {
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
      true_value: fallbackPrice,
      is_price_discovery: true,
    };
  }

  return {
    calculation_price: listPrice,
    true_value: listPrice,
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

export default { fetchTrueValue, fetchMillRate };