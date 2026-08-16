/**
 * GET /api/reno/market-snapshot?region=<raw city_region>&city=<city>&types=<keys>
 *
 * The PERSONALIZED market read behind the renovation tool's "Market trends" doorway:
 * a compact, real snapshot of the caller's OWN neighbourhood (sold-price direction,
 * time to sell, sell-through, price-cut pressure) so the CTA can promise something
 * specific instead of "what prices are doing near you".
 *
 * Sold-side figures come from raw_vow_sold, so the same VOW gate as /api/market/* applies:
 * anonymous callers get a locked shape BEFORE any RPC runs (no VOW touch, no IO spend).
 *
 * Thin scope resolution: the neighbourhood is used when it has enough recent sales to be
 * meaningful, otherwise we fall back to the city and say so (`scope: 'city'`) rather than
 * rendering a hollow number. Everything is a deterministic full-population aggregate
 * (§4 — no LLM) reusing the same 24h-cached region RPCs /analytics is built on, so the
 * deep-link the caller then follows is already warm.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getConsumer } from '@/lib/auth/requireConsumer';
import { parseTypeKeys } from '@/lib/dashboard/propertyTypes';
import {
  getTrendCached,
  getSoldDynamicsCached,
  getPriceCutsCached,
  getDomDistCached,
  getListingOutcomesCached,
  ZERO_SCOPE,
  EMPTY_SOLD_DYNAMICS,
  EMPTY_CUTS,
  EMPTY_DOM,
  EMPTY_OUTCOMES,
} from '@/lib/market/aggregates';
import { formatRegionLabel } from '@/lib/regions/formatRegionLabel';
import { computeMedianPrice, computeYoyPct, type RenoMarketSnapshotResp } from '@/lib/reno/marketSnapshot';

export const dynamic = 'force-dynamic'; // caching handled by unstable_cache per scope

// Same guard the market routes use: letters/digits/space/hyphen/apostrophe/period only.
const REGION_RE = /^[\p{L}\p{N}\s\-'.]{1,60}$/u;

/** Minimum trailing-90d sales for a neighbourhood read to stand on its own. */
const MIN_COMMUNITY_SALES = 8;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const region = (params.get('region') || '').trim();
  const city = (params.get('city') || '').trim();
  const typeKeys = parseTypeKeys(params);

  const preferred = region || city;
  if (!preferred) return NextResponse.json({ error: 'region or city is required' }, { status: 400 });
  if (!REGION_RE.test(preferred) || (city && !REGION_RE.test(city))) {
    return NextResponse.json({ error: 'Invalid region' }, { status: 400 });
  }

  // VOW gate FIRST — anon never reaches an RPC.
  const { isConsumer } = await getConsumer();
  if (!isConsumer) {
    const locked: RenoMarketSnapshotResp = {
      locked: true,
      region: preferred,
      label: formatRegionLabel(preferred),
    };
    return NextResponse.json(locked);
  }

  try {
    // 1) Try the neighbourhood. Its trend alone decides whether it can carry the read.
    let scope: 'community' | 'city' = region ? 'community' : 'city';
    let resolved = preferred;
    let trend = await getTrendCached(resolved, typeKeys, ZERO_SCOPE);

    // 2) Thin community → fall back to the city (only when it's a DIFFERENT region).
    if (scope === 'community' && trend.summary.sales90 < MIN_COMMUNITY_SALES && city && city.toLowerCase() !== resolved.toLowerCase()) {
      const cityTrend = await getTrendCached(city, typeKeys, ZERO_SCOPE);
      if (cityTrend.summary.sales90 > trend.summary.sales90) {
        scope = 'city';
        resolved = city;
        trend = cityTrend;
      }
    }

    // The shadow set: sold dynamics + price-cut pressure + the TRUE-DOM distribution
    // (relists stitched, which is the metric the board's own clock hides) + listing
    // outcomes (how many listings never sell at all). allSettled so one slow or missing
    // RPC degrades a tile instead of the card.
    const [dynR, cutsR, domR, outR] = await Promise.allSettled([
      getSoldDynamicsCached(resolved, typeKeys, ZERO_SCOPE),
      getPriceCutsCached(resolved, typeKeys, ZERO_SCOPE),
      getDomDistCached(resolved, typeKeys, ZERO_SCOPE),
      getListingOutcomesCached(resolved, typeKeys),
    ]);
    const dyn = dynR.status === 'fulfilled' ? dynR.value : EMPTY_SOLD_DYNAMICS;
    const cuts = cutsR.status === 'fulfilled' ? cutsR.value : EMPTY_CUTS;
    const dom = domR.status === 'fulfilled' ? domR.value : EMPTY_DOM;
    const out = outR.status === 'fulfilled' ? outR.value : EMPTY_OUTCOMES;

    const body: RenoMarketSnapshotResp = {
      locked: false,
      region: resolved,
      label: formatRegionLabel(resolved),
      scope,
      medianPrice: computeMedianPrice(trend.points),
      yoyPct: computeYoyPct(trend.points),
      sales90: trend.summary.sales90,
      medianDom: dyn.medianDom,
      soldToListPct: trend.summary.soldToListPct,
      cutShare: cuts.cutShare,
      medianCutPct: cuts.medianCutPct,
      underAskShare: dyn.underAskShare,
      activeCount: dom.activeCount || cuts.activeCount,
      trueDom: dom.medianTrueDom,
      naiveDom: dom.medianNaiveDom,
      stalePct: dom.stalePct,
      sellThroughPct: out.failureRate != null ? (1 - out.failureRate) * 100 : null,
      failedMedianDom: out.medianFailedDom,
    };
    return NextResponse.json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[reno/market-snapshot]', preferred, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
