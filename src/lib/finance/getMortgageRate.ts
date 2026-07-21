/**
 * getCurrentMortgageRate — the cached reader for the calculator's rate seed.
 *
 * Reads the single `market_rates` row for the 5-yr fixed (written monthly by the
 * Bank of Canada refresh job), wrapped in `unstable_cache` (24h) so page loads
 * never touch the DB on the request path. Degrades gracefully at every step:
 * a missing row, a DB error, or an out-of-band value all fall back to the dated
 * `DEFAULT_MORTGAGE_RATE_PCT` constant rather than showing a wrong or empty rate.
 *
 * The `stale` flag lets the UI mark a seed the refresh job hasn't touched in a
 * while; `asOf` feeds the "as of <month>" label. Compliance: public rate data.
 */

import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import {
  MORTGAGE_RATE_KEY,
  DEFAULT_MORTGAGE_RATE_PCT,
  MORTGAGE_RATE_MAX_STALE_DAYS,
  sanitizeRatePct,
  isRateStale,
} from "./mortgageRates";

export interface CurrentMortgageRate {
  /** Rate as a percent, e.g. 5.29. Always within the sanity band. */
  ratePct: number;
  /** ISO date the source figure is dated, or null when on the fallback. */
  asOf: string | null;
  /** True when the stored row is older than the staleness window (or absent). */
  stale: boolean;
  /** Where the value came from — a live row, or the hardcoded constant. */
  source: "live" | "fallback";
}

const FALLBACK: CurrentMortgageRate = {
  ratePct: DEFAULT_MORTGAGE_RATE_PCT,
  asOf: null,
  stale: true,
  source: "fallback",
};

async function read(): Promise<CurrentMortgageRate> {
  try {
    const sb = getServiceRoleClient();
    const { data, error } = await sb
      .from("market_rates")
      .select("rate_pct, as_of")
      .eq("key", MORTGAGE_RATE_KEY)
      .maybeSingle();

    if (error || !data) return FALLBACK;

    const rate = sanitizeRatePct(Number(data.rate_pct));
    if (rate == null) return FALLBACK; // stored value drifted out of band — don't trust it

    return {
      ratePct: rate,
      asOf: data.as_of ?? null,
      stale: isRateStale(data.as_of ?? null, MORTGAGE_RATE_MAX_STALE_DAYS),
      source: "live",
    };
  } catch {
    return FALLBACK;
  }
}

/** Current 5-yr fixed seed for the calculator (cached 24h, fallback-safe). */
export function getCurrentMortgageRate(): Promise<CurrentMortgageRate> {
  return unstable_cache(read, ["current-mortgage-rate", "v1"], { revalidate: 86_400 })();
}
