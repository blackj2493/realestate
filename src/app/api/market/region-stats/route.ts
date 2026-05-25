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
import { variantsForKeys } from "@/lib/dashboard/propertyTypes";

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

async function computeStats(region: string, propertyType: string): Promise<RegionStats> {
  const sb = getServiceRoleClient();
  // Resolve the UI key to exact PropertySubType spellings (incl. the trailing-space
  // "Semi-Detached " quirk). Empty ⇒ all types ⇒ pass null so the RPC skips the filter.
  const variants = variantsForKeys([propertyType]);
  const { data, error } = await sb.rpc("region_active_aggregates", {
    p_region: region,
    p_subtypes: variants.length ? variants : null,
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
  const propertyType = (params.get("propertyType") || "all").trim().toLowerCase();
  if (!region) return NextResponse.json({ region: "", stats: EMPTY });

  try {
    const stats = await unstable_cache(
      () => computeStats(region, propertyType),
      ["market-region-stats", region.toLowerCase(), propertyType],
      { revalidate: 86400 }
    )();
    return NextResponse.json({ region, stats });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/region-stats]", region, propertyType, msg);
    return NextResponse.json({ region, stats: EMPTY, error: msg }, { status: 500 });
  }
}
