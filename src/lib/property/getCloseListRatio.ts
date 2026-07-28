/**
 * getCloseListRatio — the cohort close/list ratio R that drives the Expected Sale Price
 * (`src/lib/avm/expectedSale.ts`). Median(close/list) over the listing's city × sub-type
 * for the trailing window, with a city-all-types fallback when the cohort is thin.
 *
 * Read-only on raw_vow_sold (§12). Wrapped in unstable_cache (24h) keyed by city × sub-type
 * so repeated detail-page loads never re-scan the 217k-row table at request time (Supabase
 * Disk IO budget — memory supabase-io-budget). Scalar columns only, recent-first, capped.
 * Mirrors the proven query in /api/market/price-trend. 100% deterministic (§4).
 *
 * Reads through the sold_close_list_rows RPC (migration 099) rather than an ILIKE filter,
 * so the lower(city) / lower(city_region) indexes are actually usable — this callsite was
 * the single largest consumer of DB time in the database (74,736 calls @ 273 ms over 4.2d).
 */

import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { normalizePropertySubType, rawVariantsOf } from "@/lib/avm/normalizeType";
import { MIN_RATIO_SAMPLES, type CloseListRatio } from "@/lib/avm/expectedSale";

const WINDOW_DAYS = 180; // ~6 months — matches the backtest's market-ratio window (M1)
const WINDOW_MONTHS = 6;
const MAX_ROWS = 12000;
const RATIO_MIN = 0.5; // sanity band — drop data-entry errors (mistyped list / relist artifacts)
const RATIO_MAX = 2.0;
const PRICE_FLOOR = 50_000; // excludes lease/rental rows that leak into the sold feed

function median(nums: number[]): number {
  if (nums.length === 0) return NaN;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function compute(
  city: string,
  normSub: string,
  rawSub: string
): Promise<CloseListRatio | null> {
  const sb = getServiceRoleClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - WINDOW_DAYS);
  // Match municipality (city) OR community (city_region), case-insensitively.
  const safe = city.replace(/[,()]/g, " ").trim();
  if (!safe) return null;
  const variants = new Set(rawVariantsOf(normSub, rawSub)); // exact spellings incl. "Semi-Detached "

  // Via RPC (migration 099), not .or('city.ilike.…'): ILIKE is the pattern operator, so
  // the planner could not use idx_vow_sold_city_lower_pcd / _cityregion_lower_pcd and
  // seq-scanned ~289k rows on every call. The RPC writes the same predicate as
  // lower(col) = lower($1), which resolves to a BitmapOr across both indexes.
  // Measured on prod: 408 ms → ~10 ms, 34,749 → ~2,800 buffers, identical result set.
  const { data, error } = await sb.rpc("sold_close_list_rows", {
    p_city: safe,
    p_price_floor: PRICE_FLOOR,
    // Date, not full ISO: PostgREST already cast the timestamp to the date column.
    p_cutoff: cutoff.toISOString().slice(0, 10),
    p_limit: MAX_ROWS,
  });

  if (error || !data) return null;

  // One scan → two accumulators: the subtype cohort, and the city all-types fallback.
  const cohort: number[] = [];
  const cityAll: number[] = [];
  for (const row of data) {
    const close = Number(row.close_price);
    const list = Number(row.list_price);
    if (!(close > 0) || !(list >= PRICE_FLOOR)) continue;
    const r = close / list;
    if (!(r > RATIO_MIN && r < RATIO_MAX)) continue;
    cityAll.push(r);
    if (variants.has(String(row.property_sub_type))) cohort.push(r);
  }

  if (cohort.length >= MIN_RATIO_SAMPLES) {
    return { ratio: median(cohort), sampleSize: cohort.length, windowMonths: WINDOW_MONTHS, scope: "cohort" };
  }
  if (cityAll.length >= MIN_RATIO_SAMPLES) {
    return { ratio: median(cityAll), sampleSize: cityAll.length, windowMonths: WINDOW_MONTHS, scope: "city" };
  }
  return null;
}

/** Cohort close/list ratio for a listing's city + sub-type, or null when too thin to trust. */
export async function getCloseListRatio(
  city: string | null,
  subType: string | null
): Promise<CloseListRatio | null> {
  if (!city || !subType) return null;
  const normSub = normalizePropertySubType(subType);
  if (!normSub) return null;
  const key = `${city.trim().toLowerCase()}|${normSub.toLowerCase()}`;
  return unstable_cache(() => compute(city, normSub, subType), ["close-list-ratio", "v1", key], {
    revalidate: 86_400,
  })();
}
