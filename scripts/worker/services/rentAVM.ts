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
import { subTypeFamily, isRentableSubType } from '@/lib/listings/subTypeFamily';
import {
  IN_HOME_UNIT_FAMILY,
  pickPreferredBasis,
  SUITE_BED_CAP,
  type MatchTier,
  type RentBasis,
  type SuiteMatchTier,
} from './rentModel';

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
  /** Whether the number is built from SIGNED leases or from current asks, and over
   *  what window (133). `match_tier` says how close the comps are; this says whether
   *  they are transactions at all. Both are needed to read the figure honestly. */
  basis?: RentBasis | null;
  /** How many comps stand behind the median. A cohort of 4 and a cohort of 40 print
   *  the same number today, and only this tells them apart. */
  sample_count?: number | null;
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
}): Promise<RentAVMResult> {
  const { bedroomsTotal, bathroomsTotal = 0 } = params;

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

  // NOTHING TO RENT, SO NO RENT.
  //
  // subTypeFamily has always known which sub-types have no dwelling in them — Vacant
  // Land, Parking Space, Sale Of Business, Office and the rest — but only the
  // `city_family` rung consulted it, via `family` below. The nbhd / city_bath / city /
  // county rungs key on the EXACT sub-type, so they happily built and served a "Vacant
  // Land" rent cohort, and a vacant lot came back with a residential rent.
  //
  // Measured on production 2026-08-30: 409 non-dwelling listings carry a rent comp and
  // 60 of them publish a cap rate INSIDE the 1-15% sanity band — so the band does not
  // catch this; a plausible-looking cap rate on an empty lot renders exactly like a
  // real one. 29 of the 60 are vacant land.
  //
  // The gate sits at the TOP because it is a fact about the property, not about the
  // comps: no rung, however precise, can price rent for a building that does not exist.
  if (!isRentableSubType(propertySubType)) {
    return { annual_rent: 0, annual_rent_p10: 0, has_data: false, match_tier: null, plus_room_aware: false };
  }

  // null for land / commercial — those skip the pooled rung entirely (124).
  const family = subTypeFamily(propertySubType);

  const sel = () => supabase.from('rental_market_index').select('avg_rent, p10_rent, basis, sample_count');

  const split = bedSplit({
    BedroomsAboveGrade: params.bedroomsAboveGrade,
    BedroomsBelowGrade: params.bedroomsBelowGrade,
    BedroomsTotal: bedroomsTotal,
  });

  type CohortRow = { avg_rent: number; p10_rent: number; basis: RentBasis; sample_count: number | null };
  let row: CohortRow | null = null;
  let tier: RentAVMResult['match_tier'] = null;
  let plusRoomAware = false;

  // The ladder runs the SPLIT cohorts across all three tiers first, then the merged
  // ones. Order matters: relaxing the plus-room before relaxing geography would hand
  // a 1+den the true-2-bedroom number, which is the exact error this fixes (measured
  // $500/mo apart in Toronto). Relaxing it LAST only ever replaces a null.
  const dims: Array<{ above: number | null; den: 0 | 1 | null; aware: boolean }> = [];
  if (split) dims.push({ above: split.above, den: split.den, aware: true });
  dims.push({ above: null, den: null, aware: false });

  /**
   * One tier probe. `bedFilter` is the only thing that differs between the split
   * and merged passes, and PostgREST needs `is(col, null)` for a NULL match — an
   * `eq(col, null)` silently matches nothing, which would make the merged fallback
   * never fire and every thin cohort read as no-data.
   *
   * SINCE 133 THIS RETURNS UP TO THREE ROWS, one per basis, and picks the best in
   * TypeScript. It deliberately does NOT filter on basis and issue three queries:
   * the ladder is already 10 round trips per listing and the recompute takes an hour
   * at that rate — asking three times per rung would make it three hours for the same
   * answer. `maybeSingle()` is gone for the same reason it had to go: it ERRORS on
   * more than one row, and after 133 more than one row is the normal case.
   */
  const probe = async (
    apply: (q: ReturnType<typeof sel>) => ReturnType<typeof sel>,
    d: { above: number | null; den: 0 | 1 | null },
  ): Promise<CohortRow | null> => {
    let q = apply(sel());
    q = d.above === null
      ? q.is('bedrooms_above', null).eq('bedrooms_total', bedroomsTotal)
      : q.eq('bedrooms_above', d.above).eq('den', d.den as number);
    const { data } = await q;
    // Signed leases before asks, recent closes before old ones — one shared rule, in
    // the model, so the four readers of this table cannot drift apart again.
    return pickPreferredBasis((data ?? []) as CohortRow[]);
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

  // THE WHOLE-HOME RENT, AND NOTHING ELSE (125).
  //
  // There was a 1.6x "suite multiplier" here, applied whenever the multi-unit scorer
  // returned EXISTING_MULTI_UNIT | PRIME_CANDIDATE | MARGINAL_CANDIDATE. Measured
  // against production 2026-08-21 that was 102,285 active for-sale listings — 54.1% of
  // the book — and 83,882 of them have no second kitchen anywhere: PRIME and MARGINAL
  // are SCORED, not observed. The uplift flowed into gross_yield_est, cap_rate_est and
  // net_monthly_cashflow, so more than half the book published a rent for a suite that
  // in most cases did not exist.
  //
  // Even where a suite DOES exist the constant was wrong: against real suite comps on
  // 13,003 comparable listings it overstated the honest split underwrite on 93.8% of
  // them, median +20.6%. The multiplier the real economics imply is 1.32x, not 1.60x.
  //
  // Suite income is now a MEASURED line from a real cohort — see fetchSuiteRent below,
  // and financialMetrics.ts for who is allowed to receive it.
  const annualRent = (row.avg_rent || 0) * 12;
  const annualRentP10 = (row.p10_rent || 0) * 12;

  return {
    annual_rent: annualRent,
    annual_rent_p10: annualRentP10,
    has_data: true,
    match_tier: tier,
    plus_room_aware: plusRoomAware,
    basis: row.basis ?? null,
    sample_count: row.sample_count ?? null,
  };
}

/**
 * Rent for the MAIN UNIT of a home that has a suite — the same ladder, asked for the
 * above-grade bedroom count with no plus-room.
 *
 * Why it exists: a "3+1" whole-home comp is a lease of the ENTIRE house to one tenant,
 * and the "+1" is the basement bedroom. Adding a suite rent to that comp charges for
 * the basement twice — measured at about 6.6% of gross income. The honest split is
 * main unit + suite, which is also the strategy an investor buying a home with a
 * second kitchen actually runs (it beats the whole-home lease on 94.5% of them, median
 * +31.9%).
 *
 * Returns has_data:false when the main-unit cohort is too thin. The caller must then
 * fall back to the whole-home comp WITHOUT a suite line, never to whole-home PLUS one.
 */
export async function fetchMainUnitRent(params: {
  city: string;
  cityRegion: string;
  propertySubType: string;
  bedroomsTotal: number;
  bedroomsAboveGrade?: number | null;
  bedroomsBelowGrade?: number | null;
  bathroomsTotal?: number;
  county?: string | null;
  /** The whole-home result already fetched for this listing. Returned unchanged when
   *  there is no plus-room to strip — see below. */
  wholeHome: RentAVMResult;
}): Promise<RentAVMResult> {
  const split = bedSplit({
    BedroomsAboveGrade: params.bedroomsAboveGrade,
    BedroomsBelowGrade: params.bedroomsBelowGrade,
    BedroomsTotal: params.bedroomsTotal,
  });
  // NO PLUS-ROOM MEANS NOTHING TO STRIP, so the whole-home comp already IS the main
  // unit and a second lookup would return the same row.
  //
  // This used to return has_data:false here, which the callers' all-or-nothing rule
  // read as "no main-unit cohort" and used to DROP the suite line entirely. It hit
  // every home with a below-grade kitchen but no below-grade bedroom — N13698568 is
  // 4+0 with KitchensBelowGrade=1 and a $1,700 suite comp sitting right there, and
  // published no suite income at all. Guarding against a 6.6% double count by
  // discarding 100% of the suite was the wrong trade.
  if (!split || split.den === 0) return params.wholeHome;
  return fetchRentAVM({
    ...params,
    bedroomsTotal: split.above,
    bedroomsAboveGrade: split.above,
    bedroomsBelowGrade: 0,
  });
}

// ── Suite rent (125) ─────────────────────────────────────────────────────────────

export interface SuiteRentResult {
  /** MONTHLY, not annual — it is presented per month everywhere it appears. */
  monthly_rent: number;
  monthly_rent_p10: number;
  has_data: boolean;
  match_tier: SuiteMatchTier | null;
  /** Signed leases or asks, same meaning as RentAVMResult.basis. */
  basis?: RentBasis | null;
  /** How many leases stand behind the median. Carried for the same reason the
   *  whole-home ladder carries it: the sandbox prints the suite rent as its own
   *  editable line, and a cohort of 4 and a cohort of 40 read identically without it. */
  sample_count?: number | null;
}

const NO_SUITE: SuiteRentResult = {
  monthly_rent: 0, monthly_rent_p10: 0, has_data: false, match_tier: null,
  basis: null, sample_count: null,
};

/**
 * Rent for an in-home suite, from the leases the whole-home ladder deliberately
 * excludes: 10,756 basement / upper / main-floor units, 12.0% of the active for-lease
 * book. Two rungs only — neighbourhood then city — because a suite's rent is set by
 * its immediate area and there is no sub-type or bath count to relax.
 *
 * Coverage measured at 84.3% of the listings that qualify for one.
 *
 * The CALLER decides who qualifies. This function answers "what does a suite rent for
 * around here", not "does this home have a suite" — mixing the two is how the 1.6x
 * multiplier came to be applied to 83,882 homes without a second kitchen.
 */
export async function fetchSuiteRent(params: {
  city: string;
  cityRegion: string;
  /** BedroomsBelowGrade. Absent or 0 underwrites as a 1-bed, the commonest basement
   *  unit — a suite with no separate bedroom still leases as a small unit, not as
   *  nothing. Capped at SUITE_BED_CAP. */
  bedroomsBelowGrade?: number | null;
}): Promise<SuiteRentResult> {
  const city = (params.city ?? '').trim();
  const cityRegion = (params.cityRegion ?? '').trim();
  const raw = params.bedroomsBelowGrade;
  const beds = Math.min(SUITE_BED_CAP, typeof raw === 'number' && raw > 0 ? Math.trunc(raw) : 1);

  const sel = () =>
    supabase
      .from('rental_market_index')
      .select('avg_rent, p10_rent, basis, sample_count')
      .eq('sub_type_family', IN_HOME_UNIT_FAMILY);

  // Geography first, then bed count — the same ordering principle as the whole-home
  // ladder (124): the right neighbourhood at the wrong size beats the right size in
  // the wrong city.
  const probes: Array<{ tier: SuiteMatchTier; run: () => ReturnType<typeof sel> }> = [];
  if (cityRegion) {
    probes.push({ tier: 'suite_nbhd', run: () => sel().eq('match_tier', 'suite_nbhd').eq('city_region', cityRegion).eq('bedrooms_total', beds) });
    if (beds !== 1) probes.push({ tier: 'suite_nbhd', run: () => sel().eq('match_tier', 'suite_nbhd').eq('city_region', cityRegion).eq('bedrooms_total', 1) });
  }
  if (city) {
    probes.push({ tier: 'suite_city', run: () => sel().eq('match_tier', 'suite_city').eq('city', city).eq('bedrooms_total', beds) });
    if (beds !== 1) probes.push({ tier: 'suite_city', run: () => sel().eq('match_tier', 'suite_city').eq('city', city).eq('bedrooms_total', 1) });
  }

  for (const p of probes) {
    // Not maybeSingle(): a suite cohort key returns one row per basis since 133, and
    // maybeSingle() ERRORS on more than one — which would have taken out every suite
    // rent the moment the closed passes landed.
    const { data } = await p.run();
    const row = pickPreferredBasis(
      (data ?? []) as Array<{ avg_rent: number; p10_rent: number; basis: RentBasis; sample_count: number | null }>
    );
    if (row) {
      return {
        monthly_rent: row.avg_rent || 0,
        monthly_rent_p10: row.p10_rent || 0,
        has_data: (row.avg_rent || 0) > 0,
        match_tier: p.tier,
        basis: row.basis ?? null,
        sample_count: row.sample_count ?? null,
      };
    }
  }
  return NO_SUITE;
}

export default fetchRentAVM;