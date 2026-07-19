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
import type { AnalyticsInitial } from "@/app/(app)/analytics/AnalyticsClient";

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
  /** mean sold price for the month (migration 082) — board-comparable; TRREB/CREA headline the average. */
  avgPrice?: number | null;
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

  // monthlyVelocity: average monthly sales over the 3 SETTLED months i = 2..4 back. We skip
  // both the current partial month AND the most-recently-completed one (sales key on
  // purchase_contract_date, which keeps accruing for weeks after a month ends). A trailing-3
  // window (not the old trailing-6) stays SEASONALLY MATCHED to the live active snapshot that
  // months-of-inventory divides: the old 6-month window reached back into the winter trough
  // while inventory was at a summer high, inflating months-of-supply ~2x vs the boards
  // (measured 2026-07 vs TRREB). Kept in Node (depends on "today"). Missing months ⇒ 0.
  const salesByMonth = new Map(points.map((p) => [p.month, p.sales]));
  const now = new Date();
  let velSum = 0;
  for (let i = 2; i <= 4; i++) {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    velSum += salesByMonth.get(monthKey(m)) ?? 0;
  }
  const monthlyVelocity = velSum > 0 ? velSum / 3 : null;

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
    ["market-price-trend", "v13", region.toLowerCase(), k], // v13 = migration 082 (avgPrice)
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
    ["market-region-stats", "v10", region.toLowerCase(), k], // v10 = migration 082 (last_seen freshness gate)
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
    ["market-dom-dist", "v5", region.toLowerCase(), k], // v5 = migration 082 (last_seen freshness gate)
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
    ["market-price-cuts", "v3", region.toLowerCase(), k], // v3 = migration 082 (last_seen freshness gate)
    { revalidate: 86400 }
  )();
}

// small numeric coercion shared by the Phase-2 computes (SQL NULL must stay null).
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── Sold dynamics (sold side, Phase-2 — migration 061) ───────────────────────────────
// Time-to-sell + original-ask→sold gap + $/sqft dispersion, one trailing-12mo pass.

export interface SoldDynamics {
  soldCount: number;
  medianDom: number | null;
  p25Dom: number | null;
  p75Dom: number | null;
  medianPpsf: number | null;
  p25Ppsf: number | null;
  p75Ppsf: number | null;
  ppsfSample: number;
  /** median % (close − original ask)/original ask; negative = sold under original ask */
  askGapMedian: number | null;
  askGapSample: number;
  /** share (0..1) that sold strictly below their ORIGINAL ask */
  underAskShare: number | null;
}

export const EMPTY_SOLD_DYNAMICS: SoldDynamics = {
  soldCount: 0, medianDom: null, p25Dom: null, p75Dom: null,
  medianPpsf: null, p25Ppsf: null, p75Ppsf: null, ppsfSample: 0,
  askGapMedian: null, askGapSample: 0, underAskShare: null,
};

async function computeSoldDynamics(region: string, typeKeys: string[], scope: Scope): Promise<SoldDynamics> {
  const sb = getServiceRoleClient();
  const variants = variantsForKeys(typeKeys);
  const { data, error } = await sb.rpc("region_sold_dynamics", {
    p_region: region,
    p_subtypes: variants.length ? variants : null,
    p_min_beds: scope.minBeds,
    p_min_baths: scope.minBaths,
    p_min_parking: scope.minParking,
    p_min_frontage: scope.minFrontage,
    p_months: MONTHS / 2, // 12-month trailing window for stable medians
    p_basement: scope.basement,
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return EMPTY_SOLD_DYNAMICS;
  return {
    soldCount: num(row.sold_count) ?? 0,
    medianDom: num(row.median_dom),
    p25Dom: num(row.p25_dom),
    p75Dom: num(row.p75_dom),
    medianPpsf: num(row.median_ppsf),
    p25Ppsf: num(row.p25_ppsf),
    p75Ppsf: num(row.p75_ppsf),
    ppsfSample: num(row.ppsf_sample) ?? 0,
    askGapMedian: num(row.ask_gap_median),
    askGapSample: num(row.ask_gap_sample) ?? 0,
    underAskShare: num(row.under_ask_share),
  };
}

/** Cached sold dynamics for a scope. Caller must pass the VOW gate first. */
export function getSoldDynamicsCached(region: string, typeKeys: string[], scope: Scope): Promise<SoldDynamics> {
  const k = `${typeKey(typeKeys)}|${scopeKey(scope)}`;
  return unstable_cache(
    () => computeSoldDynamics(region, typeKeys, scope),
    ["market-sold-dynamics", "v1", region.toLowerCase(), k], // v1 = migration 061
    { revalidate: 86400 }
  )();
}

// ── Rental yield (Phase-2 — migration 062) ───────────────────────────────────────────
// Per-bedroom typical rent (rental_market_index) + gross yield vs 12mo median sold price.

export interface RentalYieldRow {
  beds: number;
  typicalRent: number | null;
  rentSample: number;
  medianPrice: number | null;
  priceSample: number;
  grossYieldPct: number | null;
}
export interface RentalYield {
  rows: RentalYieldRow[];
}
export const EMPTY_RENTAL: RentalYield = { rows: [] };

async function computeRentalYield(region: string, typeKeys: string[]): Promise<RentalYield> {
  const sb = getServiceRoleClient();
  const variants = variantsForKeys(typeKeys);
  const { data, error } = await sb.rpc("region_rental_yield", {
    p_region: region,
    p_subtypes: variants.length ? variants : null,
  });
  if (error) throw new Error(error.message);
  const rows = (Array.isArray(data) ? data : []).map((r) => ({
    beds: num(r.beds) ?? 0,
    typicalRent: num(r.typical_rent),
    rentSample: num(r.rent_sample) ?? 0,
    medianPrice: num(r.median_price),
    priceSample: num(r.price_sample) ?? 0,
    grossYieldPct: num(r.gross_yield_pct),
  }));
  return { rows };
}

/** Cached rental yield for a region + type scope. Caller must pass the VOW gate first. */
export function getRentalYieldCached(region: string, typeKeys: string[]): Promise<RentalYield> {
  return unstable_cache(
    () => computeRentalYield(region, typeKeys),
    ["market-rental-yield", "v1", region.toLowerCase(), typeKey(typeKeys)], // v1 = migration 062
    { revalidate: 86400 }
  )();
}

// ── AVM reliability (Phase-2 — migration 062) ────────────────────────────────────────

export interface AvmReliability {
  cohortCount: number;
  salesAnalyzed: number;
  wavgR2: number | null;     // 0..1
  wavgMaePct: number | null; // sales-weighted mean abs error, %
}
export const EMPTY_AVM: AvmReliability = {
  cohortCount: 0, salesAnalyzed: 0, wavgR2: null, wavgMaePct: null,
};

async function computeAvmReliability(region: string, typeKeys: string[]): Promise<AvmReliability> {
  const sb = getServiceRoleClient();
  const variants = variantsForKeys(typeKeys);
  const { data, error } = await sb.rpc("region_avm_reliability", {
    p_region: region,
    p_subtypes: variants.length ? variants : null,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return EMPTY_AVM;
  return {
    cohortCount: num(row.cohort_count) ?? 0,
    salesAnalyzed: num(row.sales_analyzed) ?? 0,
    wavgR2: num(row.wavg_r2),
    wavgMaePct: num(row.wavg_mae_pct),
  };
}

/** Cached AVM reliability for a region + type scope. Caller must pass the VOW gate first. */
export function getAvmReliabilityCached(region: string, typeKeys: string[]): Promise<AvmReliability> {
  return unstable_cache(
    () => computeAvmReliability(region, typeKeys),
    ["market-avm-reliability", "v1", region.toLowerCase(), typeKey(typeKeys)], // v1 = migration 062
    { revalidate: 86400 }
  )();
}

// ── Inventory time-series (Phase-2 — migration 064) ──────────────────────────────────
// Daily active-inventory snapshots appended by refresh-market-summary.ts. Only the
// ~15 curated leaderboard markets have history (base scope, no type/beds lens).

export interface InventoryPoint {
  date: string; // YYYY-MM-DD
  activeCount: number | null;
  stalePct: number | null; // 0..1
  medianCapRate: number | null;
}
export interface InventoryHistory {
  points: InventoryPoint[];
}
export const EMPTY_INVENTORY: InventoryHistory = { points: [] };

async function computeInventoryHistory(region: string): Promise<InventoryHistory> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("market_summary_history")
    .select("snapshot_date, active_count, stale_count, cap_sample, median_cap_rate")
    .ilike("region", region) // exact (no wildcards) case-insensitive match on the curated name
    .order("snapshot_date", { ascending: true });
  if (error) throw new Error(error.message);
  const points: InventoryPoint[] = (data ?? []).map((r) => {
    const active = num(r.active_count);
    const stale = num(r.stale_count);
    return {
      date: String(r.snapshot_date).slice(0, 10),
      activeCount: active,
      stalePct: active && active > 0 && stale != null ? stale / active : null,
      medianCapRate: (num(r.cap_sample) ?? 0) >= 5 ? num(r.median_cap_rate) : null,
    };
  });
  return { points };
}

/** Cached inventory history for a curated market. Caller must pass the VOW gate first. */
export function getInventoryHistoryCached(region: string): Promise<InventoryHistory> {
  return unstable_cache(
    () => computeInventoryHistory(region),
    ["market-inventory-history", "v1", region.toLowerCase()], // v1 = migration 064
    { revalidate: 86400 }
  )();
}

// ── Seasonality (Phase-2 — migration 065) ────────────────────────────────────────────

export interface SeasonMonth {
  month: number; // 1..12
  sales: number;
  priceIndexPct: number | null; // median sale ÷ year-median − 1, %
  soldToList: number | null;
}
export interface Seasonality {
  months: SeasonMonth[];
}
export const EMPTY_SEASONALITY: Seasonality = { months: [] };

async function computeSeasonality(region: string, typeKeys: string[]): Promise<Seasonality> {
  const sb = getServiceRoleClient();
  const variants = variantsForKeys(typeKeys);
  const { data, error } = await sb.rpc("region_seasonality", {
    p_region: region,
    p_subtypes: variants.length ? variants : null,
  });
  if (error) throw new Error(error.message);
  const months = (Array.isArray(data) ? data : []).map((r) => ({
    month: num(r.month_num) ?? 0,
    sales: num(r.sales) ?? 0,
    priceIndexPct: num(r.price_index_pct),
    soldToList: num(r.sold_to_list),
  }));
  return { months };
}

/** Cached seasonality for a region + type scope. Caller must pass the VOW gate first. */
export function getSeasonalityCached(region: string, typeKeys: string[]): Promise<Seasonality> {
  return unstable_cache(
    () => computeSeasonality(region, typeKeys),
    ["market-seasonality", "v1", region.toLowerCase(), typeKey(typeKeys)], // v1 = migration 065
    { revalidate: 86400 }
  )();
}

// ── Listing outcomes / sell-through (Phase-2 — migration 066) ────────────────────────

export interface ListingOutcomes {
  windowMonths: number;
  soldCount: number;
  failedCount: number;
  /** share (0..1) of market exits that de-listed without a recorded sale */
  failureRate: number | null;
  medianFailedDom: number | null;
}
export const EMPTY_OUTCOMES: ListingOutcomes = {
  windowMonths: 12, soldCount: 0, failedCount: 0, failureRate: null, medianFailedDom: null,
};

async function computeListingOutcomes(region: string, typeKeys: string[]): Promise<ListingOutcomes> {
  const sb = getServiceRoleClient();
  const variants = variantsForKeys(typeKeys);
  const { data, error } = await sb.rpc("region_listing_outcomes", {
    p_region: region,
    p_subtypes: variants.length ? variants : null,
    p_months: MONTHS / 2, // 12-month trailing window
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return EMPTY_OUTCOMES;
  const soldCount = num(row.sold_count) ?? 0;
  const failedCount = num(row.failed_count) ?? 0;
  // ZERO failed listings over a 12-month window with real sold volume is impossible in this
  // market — it means the delisted feed (raw_vow_delisted) has no rows matching this region.
  // Ottawa is the case: it region-matches via CountyOrParish, which the delisted table lacks
  // (no payload column), so failed=0 → a fake "100% sell-through". Surface null ⇒ N/A, not 100%.
  const noDelistedCoverage = failedCount === 0 && soldCount > 0;
  return {
    windowMonths: num(row.window_months) ?? 12,
    soldCount,
    failedCount,
    failureRate: noDelistedCoverage ? null : num(row.failure_rate),
    medianFailedDom: num(row.median_failed_dom),
  };
}

/** Cached listing outcomes for a region + type scope. Caller must pass the VOW gate first. */
export function getListingOutcomesCached(region: string, typeKeys: string[]): Promise<ListingOutcomes> {
  return unstable_cache(
    () => computeListingOutcomes(region, typeKeys),
    ["market-listing-outcomes", "v3", region.toLowerCase(), typeKey(typeKeys)], // v3 = null failureRate when delisted feed can't match region (Ottawa)
    { revalidate: 86400 }
  )();
}

// ── Price-cut ledger (Phase-3 — migrations 069/070) ──────────────────────────────────
// Recent multi-cut activity from price_events (prospective; accrues nightly).

export interface PriceLedger {
  cutEvents: number;
  cutProperties: number;
  medianCutPct: number | null;
  medianCutAmt: number | null;
  multiCutProperties: number;
}
export const EMPTY_LEDGER: PriceLedger = {
  cutEvents: 0, cutProperties: 0, medianCutPct: null, medianCutAmt: null, multiCutProperties: 0,
};

async function computePriceLedger(region: string): Promise<PriceLedger> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.rpc("region_price_events_summary", { p_region: region, p_months: 3 });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return EMPTY_LEDGER;
  return {
    cutEvents: num(row.cut_events) ?? 0,
    cutProperties: num(row.cut_properties) ?? 0,
    medianCutPct: num(row.median_cut_pct),
    medianCutAmt: num(row.median_cut_amt),
    multiCutProperties: num(row.multi_cut_properties) ?? 0,
  };
}

/** Cached price-cut ledger summary for a market. Caller must pass the VOW gate first. */
export function getPriceLedgerCached(region: string): Promise<PriceLedger> {
  return unstable_cache(
    () => computePriceLedger(region),
    ["market-price-ledger", "v1", region.toLowerCase()], // v1 = migrations 069/070
    { revalidate: 86400 }
  )();
}

// ── AnalyticsInitial assembly + nightly precompute (Tier 3) ──────────────────────────
// The /analytics prefetch and the region_metrics precompute both need the SAME
// AnalyticsInitial shape. Share one pure assembler so they can never drift, and expose a
// raw (uncached) full-payload compute for the nightly job (unstable_cache is unavailable
// outside a request context).

/** The 11 metric results for a region+scope (each null when its RPC failed / was empty). */
export interface AnalyticsParts {
  trend: TrendResult | null;
  stats: RegionStats | null;
  dom: DomDist | null;
  cuts: PriceCuts | null;
  dynamics: SoldDynamics | null;
  rental: RentalYield | null;
  avm: AvmReliability | null;
  inventory: InventoryHistory | null;
  seasonality: Seasonality | null;
  outcomes: ListingOutcomes | null;
  ledger: PriceLedger | null;
}

/** Pure: wrap the 11 metric results into the AnalyticsInitial the client consumes.
 *  Returns undefined when every metric is null (nothing to seed). */
export function assembleAnalyticsInitial(
  region: string,
  typeKeys: string[],
  p: AnalyticsParts
): AnalyticsInitial | undefined {
  const { trend, stats, dom, cuts, dynamics, rental, avm, inventory, seasonality, outcomes, ledger } = p;
  if (!(trend || stats || dom || cuts || dynamics || rental || avm || inventory || seasonality || outcomes || ledger)) {
    return undefined;
  }
  return {
    region,
    typeKeys,
    trend: trend ? { region, points: trend.points, summary: trend.summary } : null,
    stats: stats ? { region, stats } : null,
    dom: dom ? { region, dom } : null,
    cuts: cuts ? { region, cuts } : null,
    dynamics: dynamics ? { region, dynamics } : null,
    rental: rental ? { region, rental } : null,
    avm: avm ? { region, avm } : null,
    inventory: inventory ? { region, inventory } : null,
    seasonality: seasonality ? { region, seasonality } : null,
    outcomes: outcomes ? { region, outcomes } : null,
    ledger: ledger ? { region, ledger } : null,
  };
}

/** Raw (uncached) full AnalyticsInitial — runs all 11 compute fns in parallel. Used by the
 *  nightly region_metrics precompute; the request path uses the cached getXCached fns. */
export async function computeAnalyticsInitial(
  region: string,
  typeKeys: string[],
  scope: Scope
): Promise<AnalyticsInitial | undefined> {
  const settled = await Promise.allSettled([
    computeTrend(region, typeKeys, scope),
    computeStats(region, typeKeys, scope),
    computeDomDist(region, typeKeys, scope),
    computePriceCuts(region, typeKeys, scope),
    computeSoldDynamics(region, typeKeys, scope),
    computeRentalYield(region, typeKeys),
    computeAvmReliability(region, typeKeys),
    computeInventoryHistory(region),
    computeSeasonality(region, typeKeys),
    computeListingOutcomes(region, typeKeys),
    computePriceLedger(region),
  ]);
  const v = <T,>(i: number): T | null =>
    settled[i].status === "fulfilled" ? (settled[i] as PromiseFulfilledResult<T>).value : null;
  return assembleAnalyticsInitial(region, typeKeys, {
    trend: v<TrendResult>(0),
    stats: v<RegionStats>(1),
    dom: v<DomDist>(2),
    cuts: v<PriceCuts>(3),
    dynamics: v<SoldDynamics>(4),
    rental: v<RentalYield>(5),
    avm: v<AvmReliability>(6),
    inventory: v<InventoryHistory>(7),
    seasonality: v<Seasonality>(8),
    outcomes: v<ListingOutcomes>(9),
    ledger: v<PriceLedger>(10),
  });
}

/**
 * Read the nightly-precomputed base-scope AnalyticsInitial for a region (migration 081).
 * Returns null on miss or when the snapshot is older than `maxAgeHours` (default 72h — a
 * few failed nightly runs) so the page falls back to a fresh live compute. Cached 1h so a
 * burst of loads shares one point lookup. Caller must pass the VOW gate first.
 */
export function getRegionMetricsCached(
  region: string,
  maxAgeHours = 72
): Promise<AnalyticsInitial | null> {
  return unstable_cache(
    async () => {
      const sb = getServiceRoleClient();
      const { data, error } = await sb
        .from("region_metrics")
        .select("payload, computed_at")
        .eq("region", region)
        .maybeSingle();
      if (error || !data?.payload || !data.computed_at) return null;
      const ageHours = (Date.now() - new Date(data.computed_at as string).getTime()) / 3_600_000;
      if (!Number.isFinite(ageHours) || ageHours > maxAgeHours) return null;
      return data.payload as AnalyticsInitial;
    },
    ["region-metrics", "v2", region.toLowerCase()], // v2 = migration 082 payload shape (avgPrice, freshness, sell-through N/A)
    { revalidate: 3600 }
  )();
}
