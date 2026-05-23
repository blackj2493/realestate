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

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function computeTrend(region: string): Promise<TrendPoint[]> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - MONTHS);

  const sb = getServiceRoleClient();
  // Match either municipality (city) or community (city_region). ilike = case-insensitive.
  const safe = region.replace(/[,()]/g, " ").trim();
  // PurchaseContractDate = the "Sold Date" (deal signed). close_date is the later
  // completion date and is frequently null/future, so it makes a poor trend axis.
  const { data, error } = await sb
    .from("raw_vow_sold")
    .select("close_price, purchase_contract_date, building_area_total")
    .or(`city.ilike.${safe},city_region.ilike.${safe}`)
    // $50k floor excludes lease/rental rows that leak into the sold feed (e.g. $2,200).
    .gte("close_price", 50000)
    .gte("purchase_contract_date", cutoff.toISOString())
    .order("purchase_contract_date", { ascending: false })
    .limit(MAX_ROWS);

  if (error) throw new Error(error.message);

  const buckets = new Map<string, { prices: number[]; ppsf: number[] }>();
  for (const row of data ?? []) {
    const d = row.purchase_contract_date ? new Date(row.purchase_contract_date as string) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    const price = Number(row.close_price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    let b = buckets.get(key);
    if (!b) {
      b = { prices: [], ppsf: [] };
      buckets.set(key, b);
    }
    b.prices.push(price);
    const sqft = Number(row.building_area_total);
    if (Number.isFinite(sqft) && sqft > 0) b.ppsf.push(price / sqft);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, b]) => ({
      month,
      medianPrice: Math.round(median(b.prices)),
      medianPpsf: b.ppsf.length ? Math.round(median(b.ppsf)) : null,
      sales: b.prices.length,
    }));
}

export async function GET(req: NextRequest) {
  const region = (new URL(req.url).searchParams.get("region") || "").trim();
  if (!region) return NextResponse.json({ region: "", points: [] });

  try {
    const points = await unstable_cache(
      () => computeTrend(region),
      ["market-price-trend", region.toLowerCase()],
      { revalidate: 86400 }
    )();
    return NextResponse.json({ region, points });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/price-trend]", region, msg);
    return NextResponse.json({ region, points: [], error: msg }, { status: 500 });
  }
}
