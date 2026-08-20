/**
 * Rent AVM Service
 * Phase 3: Rent AVM lookup from Supabase rental_market_index
 * 
 * Provides annual rent estimates and P10 rent for cap rate calculations.
 * Falls back gracefully when no data is available.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { bedSplit } from '@/lib/listings/bedSplit';
import { subTypeFamily } from '@/lib/listings/subTypeFamily';
import type { MatchTier } from './rentModel';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface RentAVMResult {
  annual_rent: number;
  annual_rent_p10: number;
  has_data: boolean;
  /** Which rung answered, or null when nothing did. This is the CONFIDENCE SIGNAL:
   *  error runs 5.56% at 'nbhd' and 14.49% at 'county', so a surface that shows both
   *  identically overstates the coarse one. Written to the document as
   *  `rent_match_tier` and read back by rentTierConfidence(). */
  match_tier: MatchTier | null;
  /** True when the cohort separated "+1" homes; false when it fell back to the
   *  merged whole-bedroom cohort, which mixes a 1+den in with true 2 bedrooms. */
  plus_room_aware?: boolean;
}

export async function fetchRentAVM(params: {
  city: string;
  cityRegion: string;
  propertySubType: string;
  bedroomsTotal: number;
  /** BedroomsAboveGrade / BedroomsBelowGrade. Omit both and the lookup degrades to
   *  the pre-122 merged cohorts rather than guessing a split. */
  bedroomsAboveGrade?: number | null;
  bedroomsBelowGrade?: number | null;
  bathroomsTotal?: number;
  /** CountyOrParish. Without it the ladder simply stops one rung earlier (124). */
  county?: string | null;
  isSuiteCandidate: boolean;
}): Promise<RentAVMResult> {
  const { bedroomsTotal, bathroomsTotal = 0, isSuiteCandidate } = params;

  // TRIM BOTH SIDES. rentModel btrims city / city_region / property_sub_type before it
  // keys a cohort, because the feed ships "Semi-Detached " with a trailing space. The
  // lookup used the RAW feed value against an exact .eq, so every for-sale semi asked
  // for "Semi-Detached " and matched a stored "Semi-Detached" never — 4,775 active
  // listings, all silently handed no rent data. Normalise here, not at each call site,
  // so a new caller cannot reintroduce the asymmetry.
  const city = (params.city ?? '').trim();
  const cityRegion = (params.cityRegion ?? '').trim();
  const propertySubType = (params.propertySubType ?? '').trim();
  const county = (params.county ?? '').trim();
  // null for land / commercial — those skip the pooled rung entirely (124).
  const family = subTypeFamily(propertySubType);

  const sel = () => supabase.from('rental_market_index').select('avg_rent, p10_rent');

  const split = bedSplit({
    BedroomsAboveGrade: params.bedroomsAboveGrade,
    BedroomsBelowGrade: params.bedroomsBelowGrade,
    BedroomsTotal: bedroomsTotal,
  });

  let row: { avg_rent: number; p10_rent: number } | null = null;
  let tier: RentAVMResult['match_tier'] = null;
  let plusRoomAware = false;

  // The ladder runs the SPLIT cohorts across all three tiers first, then the merged
  // ones. Order matters: relaxing the plus-room before relaxing geography would hand
  // a 1+den the true-2-bedroom number, which is the exact error this fixes (measured
  // $500/mo apart in Toronto). Relaxing it LAST only ever replaces a null.
  const dims: Array<{ above: number | null; den: 0 | 1 | null; aware: boolean }> = [];
  if (split) dims.push({ above: split.above, den: split.den, aware: true });
  dims.push({ above: null, den: null, aware: false });

  /** One tier probe. `bedFilter` is the only thing that differs between the split
   *  and merged passes, and PostgREST needs `is(col, null)` for a NULL match — an
   *  `eq(col, null)` silently matches nothing, which would make the merged fallback
   *  never fire and every thin cohort read as no-data. */
  const probe = async (
    apply: (q: ReturnType<typeof sel>) => ReturnType<typeof sel>,
    d: { above: number | null; den: 0 | 1 | null },
  ) => {
    let q = apply(sel());
    q = d.above === null
      ? q.is('bedrooms_above', null).eq('bedrooms_total', bedroomsTotal)
      : q.eq('bedrooms_above', d.above).eq('den', d.den as number);
    const { data } = await q.maybeSingle();
    return data as { avg_rent: number; p10_rent: number } | null;
  };

  for (const d of dims) {
    // Tier 1 — neighbourhood + baths (most precise)
    if (!row && cityRegion) {
      const data = await probe((q) => q
        .eq('match_tier', 'nbhd').eq('city_region', cityRegion)
        .eq('property_sub_type', propertySubType).eq('bathrooms', bathroomsTotal), d);
      if (data) { row = data; tier = 'nbhd'; plusRoomAware = d.aware; }
    }
    // Tier 2 — city + baths
    if (!row && city) {
      const data = await probe((q) => q
        .eq('match_tier', 'city_bath').eq('city', city)
        .eq('property_sub_type', propertySubType).eq('bathrooms', bathroomsTotal), d);
      if (data) { row = data; tier = 'city_bath'; plusRoomAware = d.aware; }
    }
    // Tier 3 — city, baths relaxed
    if (!row && city) {
      const data = await probe((q) => q
        .eq('match_tier', 'city').eq('city', city)
        .eq('property_sub_type', propertySubType), d);
      if (data) { row = data; tier = 'city'; plusRoomAware = d.aware; }
    }
    // Tier 4 (124) — city held, sub-type relaxed to its family. Above `county`
    // because location dominates rent: the right city with a pooled type beats the
    // right type two counties away (13.17% vs 14.49% measured).
    if (!row && city && family) {
      const data = await probe((q) => q
        .eq('match_tier', 'city_family').eq('city', city)
        .eq('sub_type_family', family), d);
      if (data) { row = data; tier = 'city_family'; plusRoomAware = d.aware; }
    }
    // Tier 5 (124) — exact sub-type held, geography widened to the county. Last rung:
    // below this the answer is no estimate, which is the correct answer for a
    // township with no rental market at all.
    if (!row && county) {
      const data = await probe((q) => q
        .eq('match_tier', 'county').eq('county', county)
        .eq('property_sub_type', propertySubType), d);
      if (data) { row = data; tier = 'county'; plusRoomAware = d.aware; }
    }
    if (row) break;
  }

  if (!row) return { annual_rent: 0, annual_rent_p10: 0, has_data: false, match_tier: null, plus_room_aware: false };

  let annualRent = (row.avg_rent || 0) * 12;
  let annualRentP10 = (row.p10_rent || 0) * 12;

  // Suite Multiplier: secondary-suite uplift (unchanged)
  if (isSuiteCandidate) {
    annualRent *= 1.6;
    annualRentP10 *= 1.6;
  }

  return { annual_rent: annualRent, annual_rent_p10: annualRentP10, has_data: true, match_tier: tier, plus_room_aware: plusRoomAware };
}

export default fetchRentAVM;