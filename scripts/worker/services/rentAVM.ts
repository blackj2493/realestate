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
  match_tier: 'nbhd' | 'city_bath' | 'city' | null; // confidence signal (Plan 2 surfaces it)
}

export async function fetchRentAVM(params: {
  city: string;
  cityRegion: string;
  propertySubType: string;
  bedroomsTotal: number;
  bathroomsTotal?: number;
  isSuiteCandidate: boolean;
}): Promise<RentAVMResult> {
  const { city, cityRegion, propertySubType, bedroomsTotal, bathroomsTotal = 0, isSuiteCandidate } = params;
  const sel = () => supabase.from('rental_market_index').select('avg_rent, p10_rent');

  let row: { avg_rent: number; p10_rent: number } | null = null;
  let tier: RentAVMResult['match_tier'] = null;

  // Tier 1 — neighbourhood + baths (most precise)
  {
    const { data } = await sel()
      .eq('match_tier', 'nbhd').eq('city_region', cityRegion)
      .eq('property_sub_type', propertySubType).eq('bedrooms_total', bedroomsTotal)
      .eq('bathrooms', bathroomsTotal).maybeSingle();
    if (data) { row = data; tier = 'nbhd'; }
  }
  // Tier 2 — city + baths
  if (!row && city) {
    const { data } = await sel()
      .eq('match_tier', 'city_bath').eq('city', city)
      .eq('property_sub_type', propertySubType).eq('bedrooms_total', bedroomsTotal)
      .eq('bathrooms', bathroomsTotal).maybeSingle();
    if (data) { row = data; tier = 'city_bath'; }
  }
  // Tier 3 — city, baths relaxed (last resort)
  if (!row && city) {
    const { data } = await sel()
      .eq('match_tier', 'city').eq('city', city)
      .eq('property_sub_type', propertySubType).eq('bedrooms_total', bedroomsTotal)
      .maybeSingle();
    if (data) { row = data; tier = 'city'; }
  }

  if (!row) return { annual_rent: 0, annual_rent_p10: 0, has_data: false, match_tier: null };

  let annualRent = (row.avg_rent || 0) * 12;
  let annualRentP10 = (row.p10_rent || 0) * 12;

  // Suite Multiplier: secondary-suite uplift (unchanged)
  if (isSuiteCandidate) {
    annualRent *= 1.6;
    annualRentP10 *= 1.6;
  }

  return { annual_rent: annualRent, annual_rent_p10: annualRentP10, has_data: true, match_tier: tier };
}

export default fetchRentAVM;