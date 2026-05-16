/**
 * Rent AVM Service
 * Phase 3: Rent AVM lookup from Supabase rental_market_index
 * 
 * Provides annual rent estimates and P10 rent for cap rate calculations.
 * Falls back gracefully when no data is available.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface RentAVMResult {
  annual_rent: number;
  annual_rent_p10: number;
  has_data: boolean;
}

export async function fetchRentAVM(params: {
  cityRegion: string;
  propertySubType: string;
  bedroomsTotal: number;
  washroomsFull?: number;
  isSuiteCandidate: boolean;
}): Promise<RentAVMResult> {
  const { cityRegion, propertySubType, bedroomsTotal, washroomsFull = 1, isSuiteCandidate } = params;

  // Try exact city_region match first
  let { data, error } = await supabase
    .from('rental_market_index')
    .select('avg_rent, p10_rent')
    .eq('city_region', cityRegion)
    .eq('property_sub_type', propertySubType)
    .eq('bedrooms_total', bedroomsTotal)
    .eq('washrooms_full', washroomsFull)
    .single();

  // Fallback: broaden to city-level
  if (!data || error) {
    const city = cityRegion.split(' ')[0]; // e.g., "Brampton East" → "Brampton"
    const { data: fallbackData } = await supabase
      .from('rental_market_index')
      .select('avg_rent, p10_rent')
      .eq('property_sub_type', propertySubType)
      .eq('bedrooms_total', bedroomsTotal)
      .like('city_region', `${city}%`)
      .order('sample_count', { ascending: false })
      .limit(1)
      .single();

    if (fallbackData) {
      // Apply 5% haircut for hyper-local variance
      data = {
        avg_rent: fallbackData.avg_rent * 0.95,
        p10_rent: fallbackData.p10_rent * 0.95,
      };
    }
  }

  if (!data) {
    return { annual_rent: 0, annual_rent_p10: 0, has_data: false };
  }

  let annualRent = (data.avg_rent || 0) * 12;
  let annualRentP10 = (data.p10_rent || 0) * 12;

  // Suite Multiplier: if property is EXISTING_SUITE or POTENTIAL_CANDIDATE
  if (isSuiteCandidate) {
    // Add 60% for secondary unit rent
    annualRent *= 1.6;
    annualRentP10 *= 1.6;
  }

  return {
    annual_rent: annualRent,
    annual_rent_p10: annualRentP10,
    has_data: true,
  };
}

export default fetchRentAVM;