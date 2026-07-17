/**
 * Region Scorecard data layer — assembles one comparable RegionScore per market area
 * from two server-side endpoints, both of which compute TRUTHFUL full-population
 * aggregates (no Typesense 100-row sampling):
 *   - /api/market/price-trend  → sold-side: median price, $/sqft, YoY, sold-to-list, velocity
 *   - /api/market/region-stats → active-side: median/top cap rate, active count, % stale
 *
 * Every value is deterministic arithmetic (§4: no LLM). Missing/untrustworthy inputs
 * surface as null so the UI shows "—" rather than a guess.
 */

import type { BasementFilter } from "@/lib/dashboard/config";

export interface RegionScore {
  region: string;
  /** VOW gate: anon received a `locked` shape from the endpoints — render a sign-in overlay. */
  locked?: boolean;
  medianPrice: number | null;
  priceSeries: { month: string; v: number }[]; // months present in the trailing ~12 (sparkline)
  yoyPct: number | null;
  medianPpsf: number | null;
  ppsfYoyPct: number | null;
  activeCount: number | null;
  monthsOfSupply: number | null;
  soldToListPct: number | null;
  pctOverAsking: number | null;
  medianCapRate: number | null;
  topCapRate: number | null;
  stalePct: number | null;
  /** median relist-stitched True Days on Market (region_dom_distribution). null on thin inventory. */
  trueDom: number | null;
  /** % of resolved SALE listings that sold, 12mo (region_listing_outcomes). null on thin sample. */
  sellThroughPct: number | null;
  temperature: "hot" | "balanced" | "cold" | null;
}

/** Minimal shapes of the two extra scorecard endpoints (full types live in aggregates.ts). */
export interface DomDistResp {
  region: string;
  dom: { activeCount: number; medianTrueDom: number | null };
  locked?: boolean;
}
export interface ListingOutcomesResp {
  region: string;
  outcomes: { soldCount: number; failedCount: number; failureRate: number | null };
  locked?: boolean;
}

export interface TrendPoint {
  month: string;
  medianPrice: number;
  medianPpsf: number | null;
  sales: number;
}

export interface PriceTrendResp {
  region: string;
  points: TrendPoint[];
  summary: {
    soldToListPct: number | null;
    pctOverAsking: number | null;
    listPriceCoverage: number;
    sales90: number;
    monthlyVelocity: number | null;
  };
  locked?: boolean;
  error?: string;
}

export interface RegionStatsResp {
  region: string;
  stats: {
    activeCount: number;
    capSample: number;
    medianCapRate: number | null;
    avgCapRate: number | null;
    topCapRate: number | null;
    staleCount: number;
  };
  locked?: boolean;
  error?: string;
}

/** Shift a "YYYY-MM" key back 12 months (same month, prior year). */
function priorYearKey(key: string): string {
  const [y, m] = key.split("-");
  return `${Number(y) - 1}-${m}`;
}

/**
 * 3-month-smoothed YoY for a TrendPoint field, ALIGNED BY MONTH LABEL (price-trend omits
 * zero-sale months, so never index by array position). Compares mean(last 3 available
 * months) vs mean(those same 3 months a year earlier). null unless both windows present.
 * Exported for reuse by Market Pulse (Phase 4).
 */
export function smoothedYoY(points: TrendPoint[], key: "medianPrice" | "medianPpsf"): number | null {
  const valByMonth = new Map<string, number>();
  for (const p of points) {
    const v = p[key];
    if (v != null && Number.isFinite(v) && v > 0) valByMonth.set(p.month, v);
  }
  const monthsWithVal = points.map((p) => p.month).filter((m) => valByMonth.has(m));
  if (monthsWithVal.length < 3) return null;

  const recent = monthsWithVal.slice(-3);
  const recentVals = recent.map((m) => valByMonth.get(m)!);
  const priorVals: number[] = [];
  for (const m of recent) {
    const pv = valByMonth.get(priorYearKey(m));
    if (pv == null) return null; // need the matching month a year earlier
    priorVals.push(pv);
  }

  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const prior = mean(priorVals);
  if (prior <= 0) return null;
  return Math.round(((mean(recentVals) / prior - 1) * 100) * 10) / 10;
}

export function temperatureOf(
  monthsOfSupply: number | null,
  soldToListPct: number | null
): RegionScore["temperature"] {
  if (monthsOfSupply == null || soldToListPct == null) return null;
  if (monthsOfSupply < 2 && soldToListPct >= 100) return "hot";
  if (monthsOfSupply > 4 || soldToListPct < 97) return "cold";
  return "balanced";
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** Optional scope dimensions of the global lens that the server medians honor. */
export interface RegionScoreScope {
  minBeds?: number;
  minBaths?: number;
  minParking?: number;
  minFrontage?: number;
  /** basement finish constraint; omit or 'any' ⇒ no filter. */
  basement?: BasementFilter;
}

export async function fetchRegionScore(
  region: string,
  typeKeys: string[] = [],
  scope: RegionScoreScope = {}
): Promise<RegionScore> {
  const q = encodeURIComponent(region);
  // Multi-type: pass the lens's selected property-type keys (empty ⇒ all types).
  // The endpoints resolve keys → exact PropertySubType spellings (variantsForKeys).
  const t = typeKeys.length ? `&types=${encodeURIComponent(typeKeys.join(","))}` : "";
  // Beds/baths/parking/frontage floors — both endpoints scope sold + active medians.
  // 0/absent ⇒ no floor. Sold side filters flat columns; active RPC reads full_payload.
  const pos = (v: number | undefined) => (v && v > 0 ? v : 0);
  const minBeds = pos(scope.minBeds);
  const minBaths = pos(scope.minBaths);
  const minParking = pos(scope.minParking);
  const minFrontage = pos(scope.minFrontage);
  // Basement finish — only sent when constraining (finished/unfinished); 'any'/absent ⇒ no param.
  const basement = scope.basement && scope.basement !== "any" ? scope.basement : "";
  const s =
    t +
    (minBeds ? `&minBeds=${minBeds}` : "") +
    (minBaths ? `&minBaths=${minBaths}` : "") +
    (minParking ? `&minParking=${minParking}` : "") +
    (minFrontage ? `&minFrontage=${minFrontage}` : "") +
    (basement ? `&basement=${basement}` : "");
  const [trendR, statsR, domR, outcomesR] = await Promise.allSettled([
    getJson<PriceTrendResp>(`/api/market/price-trend?region=${q}${s}`),
    getJson<RegionStatsResp>(`/api/market/region-stats?region=${q}${s}`),
    getJson<DomDistResp>(`/api/market/dom-distribution?region=${q}${s}`),
    // Sell-through is a market-level outcome (types honoured, numeric floors ignored server-side).
    getJson<ListingOutcomesResp>(`/api/market/listing-outcomes?region=${q}${t}`),
  ]);

  const trend = trendR.status === "fulfilled" ? trendR.value : null;
  const stats = statsR.status === "fulfilled" ? statsR.value : null;
  const dom = domR.status === "fulfilled" ? domR.value : null;
  const outcomes = outcomesR.status === "fulfilled" ? outcomesR.value : null;

  return assembleRegionScore(region, trend, stats, dom, outcomes);
}

/**
 * Pure assembly of a RegionScore from the two endpoint payloads. Split out of
 * fetchRegionScore so other surfaces (Market Trends page) that already hold the
 * raw responses can derive the identical score without a second fetch — and so
 * the derivation is unit-testable.
 */
export function assembleRegionScore(
  region: string,
  trend: PriceTrendResp | null,
  stats: RegionStatsResp | null,
  dom: DomDistResp | null = null,
  outcomes: ListingOutcomesResp | null = null
): RegionScore {
  const points = trend?.points ?? [];
  const latest = points.length ? points[points.length - 1] : null;
  const latestPpsf = [...points].reverse().find((p) => p.medianPpsf != null)?.medianPpsf ?? null;

  const activeCount = stats?.stats.activeCount ?? null;
  const monthlyVelocity = trend?.summary.monthlyVelocity ?? null;
  const monthsOfSupply =
    activeCount != null && activeCount > 0 && monthlyVelocity != null && monthlyVelocity > 0
      ? Math.round((activeCount / monthlyVelocity) * 10) / 10
      : null;

  const soldToListPct = trend?.summary.soldToListPct ?? null;
  const capSample = stats?.stats.capSample ?? 0;

  // Thin sold sample ⇒ the median/$sqft/YoY/months-supply are composition noise (e.g. 2 homes
  // drove a fake "+23% YoY"). Suppress the sold-side PRICE metrics below a recent-sales floor —
  // the same ≥10 bar the RPC uses for sold-to-list. Active-side metrics (True DoM, active count,
  // % stale, cap, sell-through) are real counts / independently guarded, so they stay.
  const sales90 = trend?.summary.sales90 ?? 0;
  const soldThin = sales90 < 10;
  const gatedMonthsOfSupply = soldThin ? null : monthsOfSupply;

  const staleCount = stats?.stats.staleCount ?? 0;
  const stalePct =
    activeCount && activeCount > 0 ? Math.round((staleCount / activeCount) * 1000) / 10 : null;

  // True DoM: median over active inventory — noise on a tiny pool, so require ≥10 active.
  const domActive = dom?.dom.activeCount ?? 0;
  const trueDom = domActive >= 10 ? dom?.dom.medianTrueDom ?? null : null;

  // Sell-through: sold ÷ (sold + withdrawn) over 12mo; require a ≥30 resolved-listing sample.
  const sold = outcomes?.outcomes.soldCount ?? 0;
  const failed = outcomes?.outcomes.failedCount ?? 0;
  const sellSample = sold + failed;
  const failureRate = outcomes?.outcomes.failureRate ?? null;
  const sellThroughPct =
    sellSample >= 30 && failureRate != null ? Math.round((1 - failureRate) * 100) : null;

  return {
    region,
    // Either endpoint returning `locked` (anonymous) locks the whole row.
    locked: !!(trend?.locked || stats?.locked),
    medianPrice: soldThin ? null : latest?.medianPrice ?? null,
    priceSeries: soldThin ? [] : points.slice(-12).map((p) => ({ month: p.month, v: p.medianPrice })),
    yoyPct: soldThin ? null : smoothedYoY(points, "medianPrice"),
    medianPpsf: soldThin ? null : latestPpsf,
    ppsfYoyPct: soldThin ? null : smoothedYoY(points, "medianPpsf"),
    activeCount,
    monthsOfSupply: gatedMonthsOfSupply,
    soldToListPct,
    pctOverAsking: trend?.summary.pctOverAsking ?? null,
    // Median over a tiny sample is noise — require ≥5 priced active listings.
    medianCapRate: capSample >= 5 ? stats?.stats.medianCapRate ?? null : null,
    topCapRate: stats?.stats.topCapRate ?? null,
    stalePct,
    trueDom,
    sellThroughPct,
    temperature: temperatureOf(gatedMonthsOfSupply, soldToListPct),
  };
}
