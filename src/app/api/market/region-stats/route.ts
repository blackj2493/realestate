/**
 * GET /api/market/region-stats?region=<city|neighbourhood>
 *
 * Full-population ACTIVE-inventory aggregates for a market area, via the
 * region_active_aggregates() RPC (migration 020): median/avg/top cap rate, active
 * count, stale count. Powers the dashboard Region Scorecard.
 *
 * These are derived STATISTICS (not listing rows), so the 100-listing display cap
 * (§6.3b) does not apply. Thin gate + cache wrapper around getStatsCached
 * (src/lib/market/aggregates) — cached 24h per scope, service-role client bypasses RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseTypeKeys } from "@/lib/dashboard/propertyTypes";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { getStatsCached, EMPTY_STATS, type RegionStats, type Scope } from "@/lib/market/aggregates";

export const dynamic = "force-dynamic"; // caching handled by unstable_cache per scope

// Re-exported for back-compat with existing importers of this route's type.
export type { RegionStats };

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const region = (params.get("region") || "").trim();
  const typeKeys = parseTypeKeys(params);
  const scope: Scope = {
    minBeds: Math.max(0, Math.floor(Number(params.get("minBeds")) || 0)),
    minBaths: Math.max(0, Number(params.get("minBaths")) || 0),
    minParking: Math.max(0, Math.floor(Number(params.get("minParking")) || 0)),
    minFrontage: Math.max(0, Number(params.get("minFrontage")) || 0),
  };
  if (!region) return NextResponse.json({ region: "", stats: EMPTY_STATS });

  // Gate: cap_rate_est is IDX-only (not VOW), so un-gating these IDX-derived region
  // aggregates is a separate compliance call (de-fake §6.2) — kept conservative for now.
  // Anonymous users get a locked shape (no data) before the cache/RPC scan.
  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ region, stats: EMPTY_STATS, locked: true });
  }

  try {
    const stats = await getStatsCached(region, typeKeys, scope);
    return NextResponse.json({ region, stats });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/region-stats]", region, msg);
    return NextResponse.json({ region, stats: EMPTY_STATS, error: msg }, { status: 500 });
  }
}
