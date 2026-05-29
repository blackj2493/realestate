/**
 * GET /api/market/price-trend?region=<city|neighbourhood>
 *
 * Monthly median SOLD price + median $/sqft for a market area over the trailing
 * 24 months, from raw_vow_sold (read-only — CLAUDE.md §12). Powers the home
 * dashboard "Market Pulse" chart — the kind of sold-trend HouseSigma shows but
 * Realtor.ca hides.
 *
 * Result is wrapped in unstable_cache (24h) so repeated dashboard loads never
 * re-scan the 217k-row table at request time (Supabase Disk IO budget — memory
 * supabase-io-budget). Uses the service-role client because raw_vow_sold is not
 * readable by the anon key (RLS).
 */

import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { variantsForKeys, parseTypeKeys } from "@/lib/dashboard/propertyTypes";

export const dynamic = "force-dynamic"; // caching is handled by unstable_cache per region

const MONTHS = 24;
// Cached 24h (one read/region/day) and only 3 small columns, so a generous cap is
// safe for the IO budget while ensuring a full 24 months of a high-volume city fits.
const MAX_ROWS = 20000;

interface TrendPoint {
  month: string; // YYYY-MM
  medianPrice: number;
  medianPpsf: number | null;
  sales: number;
}

// Region-level sold-side summary (Region Scorecard). Coverage-gated: sold-to-list is
// only trustworthy where list_price is actually populated, so it nulls out below 50%.
interface TrendSummary {
  soldToListPct: number | null; // avg(close/list)*100 over last 90d, list_price>0
  pctOverAsking: number | null; // share of those that sold above ask
  listPriceCoverage: number; // 0..1 — rows with list_price / rows, last 90d
  sales90: number; // sold count in the trailing 90 days (laggy near the edge)
  monthlyVelocity: number | null; // avg monthly sales over the 6 complete months before this one
}

interface TrendResult {
  points: TrendPoint[];
  summary: TrendSummary;
}

const EMPTY_SUMMARY: TrendSummary = {
  soldToListPct: null,
  pctOverAsking: null,
  listPriceCoverage: 0,
  sales90: 0,
  monthlyVelocity: null,
};

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function computeTrend(
  region: string,
  typeKeys: string[],
  minBeds: number,
  minBaths: number
): Promise<TrendResult> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - MONTHS);
  const cutoff90 = new Date();
  cutoff90.setDate(cutoff90.getDate() - 90);

  const sb = getServiceRoleClient();
  // Match either municipality (city) or community (city_region). ilike = case-insensitive.
  const safe = region.replace(/[,()]/g, " ").trim();
  // PurchaseContractDate = the "Sold Date" (deal signed). close_date is the later
  // completion date and is frequently null/future, so it makes a poor trend axis.
  let query = sb
    .from("raw_vow_sold")
    .select("close_price, list_price, purchase_contract_date, building_area_total")
    .or(`city.ilike.${safe},city_region.ilike.${safe}`)
    // $50k floor excludes lease/rental rows that leak into the sold feed (e.g. $2,200).
    .gte("close_price", 50000)
    .gte("purchase_contract_date", cutoff.toISOString());

  // Property-type filter: exact spelling match (incl. trailing-space "Semi-Detached ").
  // Empty ⇒ all types (unchanged behaviour).
  const variants = variantsForKeys(typeKeys);
  if (variants.length) query = query.in("property_sub_type", variants);

  // Beds/baths floor — flat sold columns (the sold feed maps BedroomsTotal →
  // bedrooms_above_grade; ingester.ts). `.gte` excludes NULL beds, matching the
  // active RPC's full_payload cast and Typesense (missing ⇒ 0). 0 ⇒ no floor.
  if (minBeds > 0) query = query.gte("bedrooms_above_grade", minBeds);
  if (minBaths > 0) query = query.gte("bathrooms_total_integer", minBaths);

  const { data, error } = await query
    .order("purchase_contract_date", { ascending: false })
    .limit(MAX_ROWS);

  if (error) throw new Error(error.message);

  const buckets = new Map<string, { prices: number[]; ppsf: number[] }>();
  // Trailing-90-day sold-to-list accumulators (current market heat).
  let r90 = 0; // sold rows in last 90d
  let r90WithList = 0; // ...with a usable list price
  let ratioSum = 0;
  let overAsk = 0;

  for (const row of data ?? []) {
    const d = row.purchase_contract_date ? new Date(row.purchase_contract_date as string) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    const price = Number(row.close_price);
    if (!Number.isFinite(price) || price <= 0) continue;

    const key = monthKey(d);
    let b = buckets.get(key);
    if (!b) {
      b = { prices: [], ppsf: [] };
      buckets.set(key, b);
    }
    b.prices.push(price);
    const sqft = Number(row.building_area_total);
    if (Number.isFinite(sqft) && sqft > 0) b.ppsf.push(price / sqft);

    if (d >= cutoff90) {
      r90++;
      const list = Number(row.list_price);
      // $50k floor mirrors close_price; ratio sanity bounds drop data-entry errors.
      if (Number.isFinite(list) && list >= 50000) {
        const ratio = price / list;
        if (ratio > 0.5 && ratio < 2) {
          r90WithList++;
          ratioSum += ratio;
          if (price > list) overAsk++;
        }
      }
    }
  }

  const points = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, b]) => ({
      month,
      medianPrice: Math.round(median(b.prices)),
      medianPpsf: b.ppsf.length ? Math.round(median(b.ppsf)) : null,
      sales: b.prices.length,
    }));

  // monthlyVelocity: average monthly sales over 6 SETTLED months. We skip not only the
  // current (partial) month but ALSO the most-recently-completed one (i starts at 2):
  // sales are keyed by purchase_contract_date, which keeps accruing for weeks after a month
  // ends because deals report to the feed late. So the latest "complete" month is still
  // under-reported when the dashboard is loaded early in the following month — including it
  // would crater velocity and spike months-of-supply. Averaging months 2..7 back keeps the
  // figure stable regardless of view date. Missing months count as 0 (genuine quiet months).
  const salesByMonth = new Map(points.map((p) => [p.month, p.sales]));
  const now = new Date();
  let velSum = 0;
  for (let i = 2; i <= 7; i++) {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    velSum += salesByMonth.get(monthKey(m)) ?? 0;
  }
  const monthlyVelocity = velSum > 0 ? velSum / 6 : null;

  const coverage = r90 > 0 ? r90WithList / r90 : 0;
  const trustworthy = coverage >= 0.5 && r90WithList >= 10;
  const summary: TrendSummary = {
    soldToListPct: trustworthy ? Math.round((ratioSum / r90WithList) * 1000) / 10 : null,
    pctOverAsking: trustworthy ? Math.round((overAsk / r90WithList) * 1000) / 10 : null,
    listPriceCoverage: Math.round(coverage * 100) / 100,
    sales90: r90,
    monthlyVelocity,
  };

  return { points, summary };
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const region = (params.get("region") || "").trim();
  const typeKeys = parseTypeKeys(params);
  const minBeds = Math.max(0, Math.floor(Number(params.get("minBeds")) || 0));
  const minBaths = Math.max(0, Number(params.get("minBaths")) || 0);
  if (!region) return NextResponse.json({ region: "", points: [], summary: EMPTY_SUMMARY });

  const typeKey = typeKeys.length ? [...typeKeys].sort().join(",") : "all";
  const cacheKey = `${typeKey}|b${minBeds}|w${minBaths}`;
  try {
    const { points, summary } = await unstable_cache(
      () => computeTrend(region, typeKeys, minBeds, minBaths),
      // v6 = beds/baths floor. v5 = multi-type keys (types=a,b). v4 = lag-robust
      // monthlyVelocity window. cacheKey folds in type + beds + baths so each
      // scope combination caches independently.
      ["market-price-trend", "v6", region.toLowerCase(), cacheKey],
      { revalidate: 86400 }
    )();
    return NextResponse.json({ region, points, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/price-trend]", region, cacheKey, msg);
    return NextResponse.json({ region, points: [], summary: EMPTY_SUMMARY, error: msg }, { status: 500 });
  }
}
