/**
 * Market board — the shared server-side data spine for the public /data trackers.
 *
 * Reads the nightly `region_metrics` precompute (one row per market, holding the full
 * base-scope AnalyticsInitial payload — migration 081/082) in a SINGLE query and derives
 * a flat per-market row for the trackers. This is the same data the gated /analytics
 * terminal shows, surfaced as AGGREGATE STATISTICS ONLY (no listing rows) — the category
 * the codebase treats as exempt from the IDX §6.3(b) display cap.
 *
 * We read region_metrics directly (rather than getRegionMetricsCached per region) so we
 * get every market + the data's `computed_at` in one round-trip, and so a stale/missing
 * precompute simply omits that market rather than triggering a heavy live recompute on a
 * public page render. The result is unstable_cache'd (1h) behind the page's own ISR.
 */
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { assembleRegionScore, type RegionScore } from "@/lib/dashboard/marketAggregates";
import { REGION_TO_CITIES, citiesFromRegions } from "@/lib/dashboard/config";

/** Canonical market list — the same 15 cities the nightly precompute + leaderboard use. */
export const BOARD_MARKETS: string[] = citiesFromRegions(Object.keys(REGION_TO_CITIES));

type AssembleArgs = Parameters<typeof assembleRegionScore>;

export interface RentalRow {
  beds: number;
  typicalRent: number | null;
  medianPrice: number | null;
  grossYieldPct: number | null;
}

interface CutsLite {
  activeCount: number;
  cutCount: number;
  cutShare: number | null; // 0..1
  medianCutAmt: number | null; // median $ reduction among cut listings
  medianCutPct: number | null; // median % reduction (already ×100, e.g. 3.2)
}

/**
 * The precompute stores the FULL DomDist (buckets, naive DoM, …), but
 * assembleRegionScore types its `dom` param down to a minimal subset. This fuller
 * shape is structurally assignable to that param, so we pass it straight through while
 * still reading buckets/medianNaiveDom here.
 */
interface DomLite {
  activeCount: number;
  medianTrueDom: number | null;
  medianNaiveDom: number | null;
  buckets: { d0_14: number; d15_30: number; d31_60: number; d61_90: number; d90plus: number };
}
interface DomRespLite {
  region: string;
  dom: DomLite;
  locked?: boolean;
}

/**
 * Structural subset of the precomputed AnalyticsInitial payload (region_metrics.payload).
 * trend/stats/dom/outcomes are typed straight off assembleRegionScore's parameters so we
 * stay in lockstep with the assembler without importing the client route's *Resp names.
 */
interface Precompute {
  trend: AssembleArgs[1];
  stats: AssembleArgs[2];
  dom?: DomRespLite | null;
  outcomes: AssembleArgs[4];
  cuts?: { cuts?: CutsLite | null } | null;
  rental?: { rental?: { rows?: RentalRow[] } | null } | null;
  dynamics?: { dynamics?: { medianDom: number | null; p25Dom: number | null; p75Dom: number | null } | null } | null;
}

export interface MarketRow {
  region: string;
  medianPrice: number | null;
  avgPrice: number | null;
  yoyPct: number | null;
  medianPpsf: number | null;
  activeCount: number | null;
  monthsOfSupply: number | null;
  soldToListPct: number | null;
  trueDom: number | null;
  medianNaiveDom: number | null;
  /** Sold-side days-to-sell (region_sold_dynamics): typical days a sold home was listed. */
  soldMedianDom: number | null;
  soldP25Dom: number | null;
  soldP75Dom: number | null;
  sellThroughPct: number | null;
  stalePct: number | null;
  temperature: RegionScore["temperature"];
  priceSeries: { month: string; v: number }[];
  // price-cut pressure
  cutShare: number | null;
  cutCount: number | null;
  cutActive: number | null;
  medianCutPct: number | null;
  medianCutAmt: number | null;
  // days-on-market distribution
  domBuckets: { d0_14: number; d15_30: number; d31_60: number; d61_90: number; d90plus: number } | null;
  // rent-vs-buy
  rentalRows: RentalRow[];
}

export interface MarketBoard {
  rows: MarketRow[];
  /** ISO timestamp of the newest region_metrics row — the "data as of" stamp. */
  dataAsOf: string | null;
}

async function computeBoard(): Promise<MarketBoard> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("region_metrics").select("region, payload, computed_at");
  if (error || !data) return { rows: [], dataAsOf: null };

  const byRegion = new Map<string, Precompute>();
  let newest: string | null = null;
  for (const r of data as { region: string; payload: Precompute; computed_at: string | null }[]) {
    byRegion.set(r.region, r.payload);
    if (r.computed_at && (!newest || r.computed_at > newest)) newest = r.computed_at;
  }

  const rows: MarketRow[] = [];
  for (const region of BOARD_MARKETS) {
    const pc = byRegion.get(region);
    if (!pc) continue;
    const score = assembleRegionScore(
      region,
      pc.trend ?? null,
      pc.stats ?? null,
      pc.dom ?? null,
      pc.outcomes ?? null
    );
    const cuts = pc.cuts?.cuts ?? null;
    const domData = pc.dom?.dom ?? null;
    const dyn = pc.dynamics?.dynamics ?? null;
    rows.push({
      region,
      medianPrice: score.medianPrice,
      avgPrice: score.avgPrice,
      yoyPct: score.yoyPct,
      medianPpsf: score.medianPpsf,
      activeCount: score.activeCount,
      monthsOfSupply: score.monthsOfSupply,
      soldToListPct: score.soldToListPct,
      trueDom: score.trueDom,
      medianNaiveDom: domData?.medianNaiveDom ?? null,
      soldMedianDom: dyn?.medianDom ?? null,
      soldP25Dom: dyn?.p25Dom ?? null,
      soldP75Dom: dyn?.p75Dom ?? null,
      sellThroughPct: score.sellThroughPct,
      stalePct: score.stalePct,
      temperature: score.temperature,
      priceSeries: score.priceSeries ?? [],
      cutShare: cuts?.cutShare ?? null,
      cutCount: cuts?.cutCount ?? null,
      cutActive: cuts?.activeCount ?? null,
      medianCutPct: cuts?.medianCutPct ?? null,
      medianCutAmt: cuts?.medianCutAmt ?? null,
      domBuckets: domData?.buckets ?? null,
      rentalRows: pc.rental?.rental?.rows ?? [],
    });
  }
  return { rows, dataAsOf: newest };
}

/** Cached market board (1h). Aggregate statistics only — safe for public pages. */
export function getMarketBoard(): Promise<MarketBoard> {
  return unstable_cache(computeBoard, ["data-market-board", "v2"], { revalidate: 3600 })();
}
