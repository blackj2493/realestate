/**
 * market_summary reader — the fast read path for precomputed base-scope market
 * aggregates (migration 048). Replaces the leaderboard's live fan-out of ~15 slow
 * region_active_aggregates RPCs with a single indexed SELECT.
 *
 * Service-role client (the table is RLS-locked, VOW-gated data). Caller is responsible
 * for the VOW consumer gate BEFORE invoking — same contract as aggregates.ts.
 */

import { getServiceRoleClient } from "@/lib/supabase/client";

export interface MarketSummary {
  region: string;
  activeCount: number | null;
  staleCount: number | null;
  capSample: number | null;
  medianCapRate: number | null;
  avgCapRate: number | null;
  topCapRate: number | null;
  trend: unknown;
  computedAt: string | null;
}

/** Leaderboard row shape (kept here so the route + its tests share one definition). */
export interface LeaderboardRow {
  region: string;
  activeCount: number | null;
  stalePct: number | null;
  medianCapRate: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(r: any): MarketSummary {
  const n = (v: unknown): number | null => {
    if (v == null) return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    region: r.region,
    activeCount: n(r.active_count),
    staleCount: n(r.stale_count),
    capSample: n(r.cap_sample),
    medianCapRate: n(r.median_cap_rate),
    avgCapRate: n(r.avg_cap_rate),
    topCapRate: n(r.top_cap_rate),
    trend: r.trend ?? null,
    computedAt: r.computed_at ?? null,
  };
}

/**
 * All precomputed market summaries, keyed by region. Returns `null` when the table
 * is absent (pre-migration) or empty (not yet refreshed) so the caller can fall back
 * to the live RPC. Never throws on a missing table.
 */
export async function getMarketSummaries(): Promise<Map<string, MarketSummary> | null> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("market_summary")
    .select("region, active_count, stale_count, cap_sample, median_cap_rate, avg_cap_rate, top_cap_rate, trend, computed_at");
  if (error || !data || data.length === 0) return null;
  return new Map(data.map((r) => [r.region as string, mapRow(r)]));
}

/**
 * Mirror of the leaderboard's row assembly (% stale of active; median cap only when
 * the priced sample is meaningful so a 1–2-listing median isn't shown as truth). Pure
 * + unit-tested. `s` is undefined when a market has no summary row yet.
 */
export function toLeaderboardRow(region: string, s: MarketSummary | undefined): LeaderboardRow {
  const activeCount = s?.activeCount ?? null;
  return {
    region,
    activeCount,
    stalePct:
      activeCount && activeCount > 0 && s?.staleCount != null
        ? Math.round((s.staleCount / activeCount) * 1000) / 10
        : null,
    medianCapRate: (s?.capSample ?? 0) >= 5 ? s?.medianCapRate ?? null : null,
  };
}
