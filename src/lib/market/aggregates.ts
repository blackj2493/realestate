/**
 * Server-side market-aggregate data layer — the single source of truth for the two
 * full-population aggregate computations behind /analytics and the dashboard:
 *
 *   - getTrendCached  → monthly sold-trend (median price/$psf, sales) + 90d summary,
 *                       via the region_price_trend RPC (migration 040 — one SQL pass;
 *                       replaced the old 8-page Node pagination over raw_vow_sold).
 *   - getStatsCached  → active-inventory scalars (cap rate, active count, stale count),
 *                       via the region_active_aggregates RPC (migration 020).
 *
 * Both are wrapped in unstable_cache (24h, aligned with the daily sync) and use the
 * service-role client because raw_vow_sold / listings aggregation must bypass anon RLS.
 * Caller is responsible for the VOW consumer gate BEFORE invoking these (the gate is
 * request-scoped and must not be folded into the request-independent cache).
 *
 * Extracted from the price-trend / region-stats route handlers so the route handlers,
 * the batched /api/market/leaderboard endpoint, and the server-rendered analytics page
 * all share ONE cached computation (and one cache entry) per scope.
 */

import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { variantsForKeys } from "@/lib/dashboard/propertyTypes";
import type { BasementFilter } from "@/lib/dashboard/config";

const MONTHS = 24;

export interface Scope {
  minBeds: number;
  minBaths: number;
  minParking: number;
  minFrontage: number;
  /** basement finish constraint (any = no filter). Mirrors the dashboard lens. */
  basement: BasementFilter;
}

export const ZERO_SCOPE: Scope = {
  minBeds: 0,
  minBaths: 0,
  minParking: 0,
  minFrontage: 0,
  basement: "any",
};

// ── Price trend (sold side) ──────────────────────────────────────────────────────────

export interface TrendPoint {
  month: string; // YYYY-MM
  medianPrice: number;
  medianPpsf: number | null;
  sales: number;
  soldToList?: number | null; // per-month sold-to-list % (migration 059)
}

export interface TrendSummary {
  soldToListPct: number | null;
  pctOverAsking: number | null;
  listPriceCoverage: number;
  sales90: number;
  monthlyVelocity: number | null;
}

export interface TrendResult {
  points: TrendPoint[];
  summary: TrendSummary;
}

export const EMPTY_SUMMARY: TrendSummary = {
  soldToListPct: null,
  pctOverAsking: null,
  listPriceCoverage: 0,
  sales90: 0,
  monthlyVelocity: null,
};

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Shape returned by the region_price_trend RPC (JSONB { points, summary }). */
interface TrendRpcResult {
  points: TrendPoint[];
  summary: Omit<TrendSummary, "monthlyVelocity">;
}

async function computeTrend(region: string, typeKeys: string[], scope: Scope): Promise<TrendResult> {
  const sb = getServiceRoleClient();
  const variants = variantsForKeys(typeKeys);

  // One SQL pass (percentile_cont by month). raw_vow_sold stays read-only (§12).
  const { data, error } = await sb.rpc("region_price_trend", {
    p_region: region,
    p_subtypes: variants.length ? variants : null,
    p_min_beds: scope.minBeds,
    p_min_baths: scope.minBaths,
    p_min_parking: scope.minParking,
    p_min_frontage: scope.minFrontage,
    p_months: MONTHS,
    p_basement: scope.basement,
  });
  if (error) throw new Error(error.message);

  const result = (data ?? {}) as Partial<TrendRpcResult>;
  const points = Array.isArray(result.points) ? result.points : [];
  const summaryBase = result.summary ?? {
    soldToListPct: null,
    pctOverAsking: null,
    listPriceCoverage: 0,
    sales90: 0,
  };

  // monthlyVelocity: average monthly sales over 6 SETTLED months (i = 2..7 back). We skip
  // both the current partial month AND the most-recently-completed one, because sales are
  // keyed by purchase_contract_date, which keeps accruing for weeks after a month ends —
  // including the latest "complete" month would crater velocity early in the next month.
  // Kept in Node (depends on "today") and unit-tested via the route. Missing months ⇒ 0.
  const salesByMonth = new Map(points.map((p) => [p.month, p.sales]));
  const now = new Date();
  let velSum = 0;
  for (let i = 2; i <= 7; i++) {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    velSum += salesByMonth.get(monthKey(m)) ?? 0;
  }
  const monthlyVelocity = velSum > 0 ? velSum / 6 : null;

  return {
    points,
    summary: {
      soldToListPct: summaryBase.soldToListPct ?? null,
      pctOverAsking: summaryBase.pctOverAsking ?? null,
      listPriceCoverage: summaryBase.listPriceCoverage ?? 0,
      sales90: summaryBase.sales90 ?? 0,
      monthlyVelocity,
    },
  };
}

// ── Region active stats ──────────────────────────────────────────────────────────────

export interface RegionStats {
  activeCount: number;
  capSample: number;
  medianCapRate: number | null;
  avgCapRate: number | null;
  topCapRate: number | null;
  staleCount: number;
}

export const EMPTY_STATS: RegionStats = {
  activeCount: 0,
  capSample: 0,
  medianCapRate: null,
  avgCapRate: null,
  topCapRate: null,
  staleCount: 0,
};

async function computeStats(region: string, typeKeys: string[], scope: Scope): Promise<RegionStats> {
  const sb = getServiceRoleClient();
  const variants = variantsForKeys(typeKeys);
  const { data, error } = await sb.rpc("region_active_aggregates", {
    p_region: region,
    p_subtypes: variants.length ? variants : null,
    p_min_beds: scope.minBeds,
    p_min_baths: scope.minBaths,
    p_min_parking: scope.minParking,
    p_min_frontage: scope.minFrontage,
    p_basement: scope.basement,
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return EMPTY_STATS;

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

// ── Cache wrappers ───────────────────────────────────────────────────────────────────

const scopeKey = (s: Scope) =>
  `b${s.minBeds}|w${s.minBaths}|p${s.minParking}|f${s.minFrontage}|x${s.basement}`;
const typeKey = (typeKeys: string[]) => (typeKeys.length ? [...typeKeys].sort().join(",") : "all");

/** Cached monthly sold-trend for a scope. Caller must pass the VOW gate first. */
export function getTrendCached(region: string, typeKeys: string[], scope: Scope): Promise<TrendResult> {
  const k = `${typeKey(typeKeys)}|${scopeKey(scope)}`;
  return unstable_cache(
    () => computeTrend(region, typeKeys, scope),
    // v12 = CountyOrParish roll-up (migration 047 — fixes Ottawa, which cached empty under v11);
    // v11 = basement filter (043); v10 = Toronto district roll-up (042); v9 = RPC (040).
    // Bumped so stale empty Ottawa entries (and any v11 entry) are not served post-migration.
    ["market-price-trend", "v12", region.toLowerCase(), k],
    { revalidate: 86400 }
  )();
}

/** Cached active-inventory stats for a scope. Caller must pass the VOW gate first. */
export function getStatsCached(region: string, typeKeys: string[], scope: Scope): Promise<RegionStats> {
  const k = `${typeKey(typeKeys)}|${scopeKey(scope)}`;
  return unstable_cache(
    () => computeStats(region, typeKeys, scope),
    // v7 = CountyOrParish roll-up (migration 047 — fixes Ottawa, which cached empty under v6);
    // v6 = basement filter (043); v5 = Toronto district roll-up (042); v4 = parking (027).
    // Bumped so stale empty Ottawa entries (and any v6 entry) are not served post-migration.
    ["market-region-stats", "v7", region.toLowerCase(), k],
    { revalidate: 86400 }
  )();
}

// ── True-DoM distribution (active side, Tier-1 panel) ────────────────────────────────

export interface DomDist {
  activeCount: number;
  medianTrueDom: number | null;
  /** median naive DOM (days since OriginalEntryTimestamp — resets on relist). Hidden-gap contrast. */
  medianNaiveDom: number | null;
  p25: number | null;
  p75: number | null;
  /** share of active with true_dom >= 61 (60d+ stale line), 0..1 */
  stalePct: number | null;
  buckets: { d0_14: number; d15_30: number; d31_60: number; d61_90: number; d90plus: number };
}

export const EMPTY_DOM: DomDist = {
  activeCount: 0, medianTrueDom: null, medianNaiveDom: null, p25: null, p75: null, stalePct: null,
  buckets: { d0_14: 0, d15_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 },
};

async function computeDomDist(region: string, typeKeys: string[], scope: Scope): Promise<DomDist> {
  const sb = getServiceRoleClient();
  const variants = variantsForKeys(typeKeys);
  const { data, error } = await sb.rpc("region_dom_distribution", {
    p_region: region,
    p_subtypes: variants.length ? variants : null,
    p_min_beds: scope.minBeds,
    p_min_baths: scope.minBaths,
    p_min_parking: scope.minParking,
    p_min_frontage: scope.minFrontage,
    p_basement: scope.basement,
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return EMPTY_DOM;

  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const active = num(row.active_count) ?? 0;
  const buckets = {
    d0_14: num(row.dom_0_14) ?? 0,
    d15_30: num(row.dom_15_30) ?? 0,
    d31_60: num(row.dom_31_60) ?? 0,
    d61_90: num(row.dom_61_90) ?? 0,
    d90plus: num(row.dom_90_plus) ?? 0,
  };
  return {
    activeCount: active,
    medianTrueDom: num(row.median_true_dom),
    medianNaiveDom: num(row.median_naive_dom),
    p25: num(row.p25_true_dom),
    p75: num(row.p75_true_dom),
    stalePct: active > 0 ? (buckets.d61_90 + buckets.d90plus) / active : null,
    buckets,
  };
}

/** Cached True-DoM distribution for a scope. Caller must pass the VOW gate first. */
export function getDomDistCached(region: string, typeKeys: string[], scope: Scope): Promise<DomDist> {
  const k = `${typeKey(typeKeys)}|${scopeKey(scope)}`;
  return unstable_cache(
    () => computeDomDist(region, typeKeys, scope),
    ["market-dom-dist", "v2", region.toLowerCase(), k], // v2 = migration 057 (+ median_naive_dom)
    { revalidate: 86400 }
  )();
}

// ── Price-cut pressure (active side, Tier-1 B) ───────────────────────────────────────

export interface PriceCuts {
  activeCount: number;
  cutCount: number;
  /** share of active with a price cut, 0..1 */
  cutShare: number | null;
  medianCutAmt: number | null; // median $ reduction among cut listings
  medianCutPct: number | null; // median % reduction among cut listings
}

export const EMPTY_CUTS: PriceCuts = {
  activeCount: 0, cutCount: 0, cutShare: null, medianCutAmt: null, medianCutPct: null,
};

async function computePriceCuts(region: string, typeKeys: string[], scope: Scope): Promise<PriceCuts> {
  const sb = getServiceRoleClient();
  const variants = variantsForKeys(typeKeys);
  const { data, error } = await sb.rpc("region_price_cuts", {
    p_region: region,
    p_subtypes: variants.length ? variants : null,
    p_min_beds: scope.minBeds,
    p_min_baths: scope.minBaths,
    p_min_parking: scope.minParking,
    p_min_frontage: scope.minFrontage,
    p_basement: scope.basement,
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return EMPTY_CUTS;

  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const active = num(row.active_count) ?? 0;
  const cuts = num(row.cut_count) ?? 0;
  return {
    activeCount: active,
    cutCount: cuts,
    cutShare: active > 0 ? cuts / active : null,
    medianCutAmt: num(row.median_cut_amt),
    medianCutPct: num(row.median_cut_pct),
  };
}

/** Cached price-cut pressure for a scope. Caller must pass the VOW gate first. */
export function getPriceCutsCached(region: string, typeKeys: string[], scope: Scope): Promise<PriceCuts> {
  const k = `${typeKey(typeKeys)}|${scopeKey(scope)}`;
  return unstable_cache(
    () => computePriceCuts(region, typeKeys, scope),
    ["market-price-cuts", "v1", region.toLowerCase(), k], // v1 = migration 058 (region_price_cuts)
    { revalidate: 86400 }
  )();
}
