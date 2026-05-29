/**
 * GET /api/market/region-stats?region=<city|neighbourhood>
 *
 * Full-population ACTIVE-inventory aggregates for a market area, via the
 * region_active_aggregates() RPC (migration 020): median/avg/top cap rate, active
 * count, stale count. Powers the dashboard Region Scorecard.
 *
 * These are derived STATISTICS (not listing rows), so the 100-listing display cap
 * (§6.3b) does not apply — the RPC scans the whole active set server-side and returns
 * only scalars. Cap rate is the Node-ETL ExtrapolatedCapRate, persisted to a column;
 * SQL only aggregates it (§4 keeps the derived-metric computation in Node).
 *
 * Wrapped in unstable_cache (24h, aligned with the daily sync) and uses the
 * service-role client because `listings` aggregation must bypass anon RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { variantsForKeys, parseTypeKeys } from "@/lib/dashboard/propertyTypes";

export const dynamic = "force-dynamic"; // caching handled by unstable_cache per region

export interface RegionStats {
  activeCount: number;
  capSample: number;
  medianCapRate: number | null;
  avgCapRate: number | null;
  topCapRate: number | null;
  staleCount: number;
}

const EMPTY: RegionStats = {
  activeCount: 0,
  capSample: 0,
  medianCapRate: null,
  avgCapRate: null,
  topCapRate: null,
  staleCount: 0,
};

async function computeStats(
  region: string,
  typeKeys: string[],
  minBeds: number,
  minBaths: number,
  minParking: number,
  minFrontage: number
): Promise<RegionStats> {
  const sb = getServiceRoleClient();
  // Resolve the UI keys to exact PropertySubType spellings (incl. the trailing-space
  // "Semi-Detached " quirk). Empty ⇒ all types ⇒ pass null so the RPC skips the filter.
  const variants = variantsForKeys(typeKeys);
  // Any floor at 0 ⇒ no filter (migrations 026/027 short-circuit the JSONB cast).
  const { data, error } = await sb.rpc("region_active_aggregates", {
    p_region: region,
    p_subtypes: variants.length ? variants : null,
    p_min_beds: minBeds,
    p_min_baths: minBaths,
    p_min_parking: minParking,
    p_min_frontage: minFrontage,
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return EMPTY;

  const num = (v: unknown): number | null => {
    if (v == null) return null; // SQL NULL must stay null (Number(null) === 0 would lie)
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    activeCount: num(row.active_count) ?? 0,
    capSample: num(row.cap_sample) ?? 0,
    medianCapRate: num(row.median_cap_rate),
    avgCapRate: num(row.avg_cap_rate),
    topCapRate: num(row.top_cap_rate),
    staleCount: num(row.stale_count) ?? 0,
  };
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const region = (params.get("region") || "").trim();
  const typeKeys = parseTypeKeys(params);
  const minBeds = Math.max(0, Math.floor(Number(params.get("minBeds")) || 0));
  const minBaths = Math.max(0, Number(params.get("minBaths")) || 0);
  const minParking = Math.max(0, Math.floor(Number(params.get("minParking")) || 0));
  const minFrontage = Math.max(0, Number(params.get("minFrontage")) || 0);
  if (!region) return NextResponse.json({ region: "", stats: EMPTY });

  const typeKey = typeKeys.length ? [...typeKeys].sort().join(",") : "all";
  const cacheKey = `${typeKey}|b${minBeds}|w${minBaths}|p${minParking}|f${minFrontage}`;
  try {
    const stats = await unstable_cache(
      () => computeStats(region, typeKeys, minBeds, minBaths, minParking, minFrontage),
      // v4 = parking/frontage floor (migration 027). v3 = beds/baths (026). cacheKey
      // folds in type + beds + baths + parking + frontage.
      ["market-region-stats", "v4", region.toLowerCase(), cacheKey],
      { revalidate: 86400 }
    )();
    return NextResponse.json({ region, stats });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/region-stats]", region, cacheKey, msg);
    return NextResponse.json({ region, stats: EMPTY, error: msg }, { status: 500 });
  }
}
