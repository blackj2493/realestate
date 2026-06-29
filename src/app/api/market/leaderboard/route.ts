/**
 * GET /api/market/leaderboard
 *
 * Active-inventory ranking (median cap rate, % stale, active count) for every curated GTA
 * market. Reads the nightly-precomputed `market_summary` table (migration 048) in ONE
 * indexed SELECT — no live aggregation. Before this, the route fanned out ~15 concurrent
 * region_active_aggregates RPCs, each ~8–43s and detoasting full_payload; Toronto exceeded
 * the 30s Supabase fetch timeout and the whole page hung. The precompute moves that cost off
 * the request path into the daily sync (refresh-market-summary.ts). The live RPC path is
 * kept only as a self-healing fallback for the brief window before the first refresh.
 */

import { NextResponse } from "next/server";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { REGION_TO_CITIES, citiesFromRegions } from "@/lib/dashboard/config";
import { getStatsCached, ZERO_SCOPE } from "@/lib/market/aggregates";
import { getMarketSummaries, toLeaderboardRow, type LeaderboardRow } from "@/lib/market/marketSummary";

export const dynamic = "force-dynamic";

// Markets excluded from the leaderboard. Ottawa is OREB territory, not TRREB's GTA feed —
// sparse, free-form spillover that can't be ranked fairly, so it's dropped rather than shown
// misleadingly. (It IS precomputed into market_summary; we just don't surface it here.)
const EXCLUDED_MARKETS = new Set(["Ottawa"]);

/** Curated GTA market set, flattened from the apply-flow region map, minus excluded markets. */
const MARKETS = citiesFromRegions(Object.keys(REGION_TO_CITIES)).filter((m) => !EXCLUDED_MARKETS.has(m));

export type { LeaderboardRow };

/**
 * Live fallback (the old behaviour): runs the slow RPCs via the 24h-cached getStatsCached
 * when the precompute table is empty (pre-first-refresh). Reuses toLeaderboardRow so the row
 * assembly never drifts from the fast path.
 */
async function liveRow(region: string): Promise<LeaderboardRow> {
  const s = await getStatsCached(region, [], ZERO_SCOPE);
  return toLeaderboardRow(region, {
    region,
    activeCount: s.activeCount,
    staleCount: s.staleCount,
    capSample: s.capSample,
    medianCapRate: s.medianCapRate,
    avgCapRate: s.avgCapRate,
    topCapRate: s.topCapRate,
    trend: null,
    computedAt: null,
  });
}

export async function GET() {
  // Mounted on the auth-gated Market Trends page; anon callers get a locked shape.
  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({ markets: [], locked: true });
  }

  try {
    // Fast path: the nightly-precomputed table — one SELECT, no live aggregation, no detoast.
    const summaries = await getMarketSummaries();
    if (summaries) {
      const markets = MARKETS.map((region) => toLeaderboardRow(region, summaries.get(region)));
      return NextResponse.json({ markets, source: "precomputed" });
    }

    // Fallback: live RPCs (table absent / not yet refreshed). Same result, slower; self-heals
    // the moment refresh-market-summary.ts has run once.
    const markets = await Promise.all(MARKETS.map(liveRow));
    return NextResponse.json({ markets, source: "live" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/leaderboard]", msg);
    return NextResponse.json({ markets: [], error: msg }, { status: 500 });
  }
}
