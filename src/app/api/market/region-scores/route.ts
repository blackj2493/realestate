/**
 * GET /api/market/region-scores?regions=A,B,C[&types=&minBeds=…]
 *
 * BATCHED dashboard Region Scorecard. Replaces the old client fan-out where
 * RegionScorecard fired 4 fetches per region (price-trend + region-stats +
 * dom-distribution + listing-outcomes) — N×4 browser requests, each re-running the
 * consumer gate (getUser network call + terms lookup), throttled to ~6 concurrent.
 *
 * Here the VOW gate runs ONCE for the whole batch, all regions' four aggregates run in
 * parallel server-side (no browser connection cap), and each RegionScore is assembled
 * with the same pure assembleRegionScore() the client used — so the shape is identical.
 * Each underlying cached fn is 24h-memoized per scope, so warm regions return instantly.
 *
 * Derived STATISTICS only (no listing rows) — the §6.3(b) display cap does not apply.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseTypeKeys } from "@/lib/dashboard/propertyTypes";
import { getConsumer } from "@/lib/auth/requireConsumer";
import {
  getTrendCached,
  getStatsCached,
  getDomDistCached,
  getListingOutcomesCached,
  getRegionMetricsCached,
  EMPTY_SUMMARY,
  EMPTY_STATS,
  type Scope,
} from "@/lib/market/aggregates";
import { assembleRegionScore, type RegionScore } from "@/lib/dashboard/marketAggregates";

export const dynamic = "force-dynamic"; // per-scope caching handled by unstable_cache

// Same region grammar the single endpoints use — excludes PostgREST/ilike metacharacters.
const REGION_RE = /^[\p{L}\p{N}\s\-'.]{1,60}$/u;
const MAX_REGIONS = 24; // saved-region lists are small; bound the fan-out defensively.

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const regions = Array.from(
    new Set(
      (params.get("regions") || "")
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r && REGION_RE.test(r))
    )
  ).slice(0, MAX_REGIONS);
  const typeKeys = parseTypeKeys(params);
  const basementRaw = params.get("basement");
  const scope: Scope = {
    minBeds: Math.max(0, Math.floor(Number(params.get("minBeds")) || 0)),
    minBaths: Math.max(0, Number(params.get("minBaths")) || 0),
    minParking: Math.max(0, Math.floor(Number(params.get("minParking")) || 0)),
    minFrontage: Math.max(0, Number(params.get("minFrontage")) || 0),
    basement: basementRaw === "finished" || basementRaw === "unfinished" ? basementRaw : "any",
  };

  if (!regions.length) return NextResponse.json({ scores: [] });

  // VOW gate ONCE for the batch. Anonymous / un-accepted callers get a locked row per
  // region (count/shape only — no VOW values reach them), matching the single endpoints.
  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    return NextResponse.json({
      locked: true,
      scores: regions.map((region) =>
        assembleRegionScore(
          region,
          { region, points: [], summary: EMPTY_SUMMARY, locked: true },
          { region, stats: EMPTY_STATS, locked: true },
          null,
          null
        )
      ),
    });
  }

  // The base view (no type/scope filters) can be served from the nightly precompute (081) —
  // a point lookup that also skips the residual slow RPCs (listing-outcomes for big regions).
  // Any custom type/scope filter, or a precompute miss/stale, computes live.
  const isBaseView =
    typeKeys.length === 0 &&
    scope.minBeds === 0 &&
    scope.minBaths === 0 &&
    scope.minParking === 0 &&
    scope.minFrontage === 0 &&
    scope.basement === "any";

  const liveScore = async (region: string): Promise<RegionScore> => {
    const [trendR, statsR, domR, outcomesR] = await Promise.allSettled([
      getTrendCached(region, typeKeys, scope),
      getStatsCached(region, typeKeys, scope),
      getDomDistCached(region, typeKeys, scope),
      // Sell-through is market-level: types honoured, numeric floors ignored server-side.
      getListingOutcomesCached(region, typeKeys),
    ]);
    const trend =
      trendR.status === "fulfilled"
        ? { region, points: trendR.value.points, summary: trendR.value.summary }
        : null;
    const stats = statsR.status === "fulfilled" ? { region, stats: statsR.value } : null;
    const dom = domR.status === "fulfilled" ? { region, dom: domR.value } : null;
    const outcomes = outcomesR.status === "fulfilled" ? { region, outcomes: outcomesR.value } : null;
    return assembleRegionScore(region, trend, stats, dom, outcomes);
  };

  const scores: RegionScore[] = await Promise.all(
    regions.map(async (region) => {
      if (isBaseView) {
        const pc = await getRegionMetricsCached(region);
        // The stored AnalyticsInitial already holds trend/stats/dom/outcomes as the exact
        // *Resp shapes assembleRegionScore expects.
        if (pc) return assembleRegionScore(region, pc.trend, pc.stats, pc.dom, pc.outcomes);
      }
      return liveScore(region);
    })
  );

  return NextResponse.json({ scores });
}
