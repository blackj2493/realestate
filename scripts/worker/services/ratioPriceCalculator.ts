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
 * Smallest list price that can plausibly BUY a dwelling in this market.
 *
 * Below this a "price" is not a price: it is a bidding-war placeholder ($1 is the
 * common one), a deposit, or a typo. Measured on production 2026-08-30 there are 578
 * active sale listings under $1,000 and 539 more under $50,000 — the second group
 * contains real cheap stock (northern Ontario, mobile homes on leased land), so the
 * line is drawn low and hard rather than at a level that would silently blank
 * thousands of legitimate cap rates.
 */
export const MIN_PLAUSIBLE_SALE_PRICE = 10_000;

/**
 * Resolve the ratio-price basis for Cap Rate / Gross Yield / Tax Burden.
 *
 * WHAT WENT WRONG. This substituted a city-region average for "$1 bidding war"
 * listings — but only for Detached and Semi-Detached under $200K, and only where
 * `city_region_avg_price` had a row. Measured on production 2026-08-30:
 *
 *   • the sub-type allowlist missed 161 of the 222 affected listings. MobileTrailer
 *     (76) and Vacant Land (72) are not Detached, so the guard never ran.
 *   • `city_region_avg_price` holds 21 regions. `listings` spans 2,134. So for ~99%
 *     of the country the lookup found nothing.
 *   • and on that miss, `data?.avg_sale_price || listPrice` returned THE $1 ITSELF,
 *     while still reporting is_price_discovery: true. The flag said "we substituted a
 *     real price" about the placeholder it had failed to replace.
 *
 * The result reached production: cap_rate_est of 19,768,692% on C13591550, and 296
 * listings above the 15% sanity band. CAP_RATE_BAND hides them at render, so nothing
 * looked broken — but the raw values sit in the public Typesense index, where they are
 * filterable and sortable by anyone.
 *
 * THE RULE NOW: a ratio needs a credible denominator, and when there is none the
 * honest output is NO METRIC, not a metric divided by a placeholder. Returning
 * calculation_price: 0 hands the caller straight to the zero-price guard already in
 * financialMetrics.ts (audit LOW-10), which publishes the 0 sentinel across every
 * ratio. That guard was written for exactly this and could never be reached, because
 * a placeholder is a positive number.
 *
 * `is_price_discovery` now means what it says: a real substitute was found.
 */
export async function resolveRatioPrice(params: {
  listPrice: number;
  propertySubType: string;
  cityRegion: string;
}): Promise<RatioPriceResult> {
  const { listPrice, cityRegion } = params;

  // A plausible ask needs no discovery at all — the overwhelmingly common path.
  if (listPrice >= MIN_PLAUSIBLE_SALE_PRICE) {
    return { calculation_price: listPrice, is_price_discovery: false };
  }

  // Below the floor the list price is unusable. Try for a real regional substitute —
  // NO SUB-TYPE ALLOWLIST. A $1 ask is a $1 ask whether the home is detached, a condo
  // or a mobile; the old allowlist is what let 161 of them through.
  if (cityRegion) {
    // maybeSingle, not single: a missing region is the NORMAL case here (21 rows cover
    // 2,134 regions) and `single()` treats it as an error worth throwing about.
    const { data } = await supabase
      .from('city_region_avg_price')
      .select('avg_sale_price')
      .eq('city_region', cityRegion)
      .maybeSingle();
    const avg = Number((data as { avg_sale_price: number } | null)?.avg_sale_price ?? 0);
    // The substitute must clear the same bar it is replacing — otherwise a bad row in
    // the lookup table reintroduces the exact fault.
    if (avg >= MIN_PLAUSIBLE_SALE_PRICE) {
      return { calculation_price: avg, is_price_discovery: true };
    }
  }

  // No credible denominator. NOT the list price — that is the placeholder that produced
  // a 19-million-percent cap rate. Zero routes to the zero-price guard, which publishes
  // no ratio metrics at all.
  return { calculation_price: 0, is_price_discovery: false };
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
