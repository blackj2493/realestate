/**
 * GET /api/market/leaderboard
 *
 * One batched payload for the Submarket Leaderboard: the active-inventory ranking
 * fields (median cap rate, % stale, active count) for every curated GTA market.
 *
 * Replaces the old client fan-out where SubmarketLeaderboard called fetchRegionScore
 * for all 15 markets — 30 requests (price-trend + region-stats each), of which the 15
 * price-trend calls were pure waste because the leaderboard never displays sold-trend
 * data. This endpoint computes only region-stats, once, server-side, behind a single
 * VOW gate and a single network round-trip. Per-region results reuse getStatsCached, so
 * they share the exact cache entries the Region Scorecard / region-stats route populate.
 */

import { NextResponse } from "next/server";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { REGION_TO_CITIES, citiesFromRegions } from "@/lib/dashboard/config";
import { getStatsCached, ZERO_SCOPE } from "@/lib/market/aggregates";

export const dynamic = "force-dynamic"; // caching handled by unstable_cache per region

// Markets excluded from the leaderboard. Ottawa is OREB territory, not TRREB's GTA feed —
// it appears only as sparse, free-form spillover ("Glebe - Ottawa East and Area", ~580 active)
// that can't be matched cleanly or ranked fairly, so it's dropped rather than shown misleadingly.
const EXCLUDED_MARKETS = new Set(["Ottawa"]);

/** Curated GTA market set, flattened from the apply-flow region map, minus excluded markets. */
const MARKETS = citiesFromRegions(Object.keys(REGION_TO_CITIES)).filter((m) => !EXCLUDED_MARKETS.has(m));

export interface LeaderboardRow {
  region: string;
  activeCount: number | null;
  stalePct: number | null;
  medianCapRate: number | null;
}

export async function GET() {
  // Mounted on the auth-gated Market Trends page; anon callers get a locked shape.
  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ markets: [], locked: true });
  }

  try {
    const markets: LeaderboardRow[] = await Promise.all(
      MARKETS.map(async (region) => {
        const s = await getStatsCached(region, [], ZERO_SCOPE);
        const activeCount = s.activeCount;
        return {
          region,
          activeCount,
          // Mirror assembleRegionScore: % stale of active, and median cap only when the
          // priced sample is meaningful (>=5) so a 1-2 listing median isn't shown as truth.
          stalePct: activeCount > 0 ? Math.round((s.staleCount / activeCount) * 1000) / 10 : null,
          medianCapRate: s.capSample >= 5 ? s.medianCapRate : null,
        };
      })
    );
    return NextResponse.json({ markets });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/leaderboard]", msg);
    return NextResponse.json({ markets: [], error: msg }, { status: 500 });
  }
}
