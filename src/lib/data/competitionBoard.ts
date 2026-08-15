/**
 * Competition board — server-side data for the public /data/over-asking tracker.
 *
 * Reads cells precomputed nightly by scripts/admin/refresh-sale-competition-stats.ts
 * (migration 120): what happened to a home's price relative to the seller's final ask.
 *
 * WHY THIS TRACKER EXISTS: "sold over asking" is the most-quoted phrase in Canadian housing
 * coverage and nobody publishes the rate. TRREB publishes average price, sales and new
 * listings; CREA publishes a price index; WOWA and HouseSigma carry city-level supply/demand
 * ratios. Redfin has published "share sold above final list price" for years and it is one of
 * their most-cited series — this is the Ontario equivalent, at neighbourhood grain.
 *
 * SCOPE IS DELIBERATELY NARROW. No days-on-market measure lives here: /data/days-on-market
 * already owns speed-of-sale with stitched relist-adjusted True DOM, and a second
 * campaign-scoped "how fast" number on a sibling page is the same failure #250 cleaned up.
 * This page answers one question — what happened to the PRICE against the ask.
 *
 * Aggregate statistics only — no listing rows, ever.
 */
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { displayArea, displayCity } from "@/lib/data/areaNames";

export type PropertyGroup = "House" | "Condo";

/** Reserved key for the province-wide rollup written by the refresh job. */
const PROVINCE_CITY = "Ontario";

export interface CompetitionRow {
  city: string;
  area: string;
  group: PropertyGroup;
  /** Share of sales closing ABOVE the final ask, 0–100. */
  pctOverAsk: number;
  pctAtAsk: number | null;
  pctUnderAsk: number | null;
  /** Median close/list × 100. Above 100 means the typical home sold over ask. */
  medianSaleToList: number | null;
  /** Median $ above ask, among sales that went above. */
  medianPremium: number | null;
  /** Median $ below ask, among sales that went below. */
  medianDiscount: number | null;
  /** Share whose final ask was below their original ask. */
  pctCutBeforeSale: number | null;
  /** Change in the over-ask RATE vs the prior 12 months, in percentage POINTS. */
  yoyOverAskPts: number | null;
  sampleCount: number;
  priorSample: number;
}

export interface CompetitionBoard {
  /** Neighbourhood cells. The page filters and ranks. */
  rows: CompetitionRow[];
  /** Province-wide figures — the headline strip. */
  summary: CompetitionRow[];
  dataAsOf: string | null;
}

/**
 * Below this a row is shown but marked, so a reader can discount it themselves.
 *
 * Higher than the rent tracker's threshold on purpose. A SHARE is noisier than a median at
 * the same n: the standard error on an 18% rate is ±7.0 points at n=30 but ±3.8 at n=100.
 * 30 is enough to store a number; it is not enough to call a neighbourhood competitive.
 */
export const THIN_SAMPLE = 100;
/**
 * A neighbourhood is only offered in a RANKING at this sample. "Most competitive
 * neighbourhood in Ontario" is the most quotable and least robust cut on the page, and a
 * 31-sale hamlet topping that list would be the story rather than the market.
 */
export const RANK_MIN_SAMPLE = 100;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** PostgREST hard-caps a single response at 1000 rows — must paginate. */
const PAGE = 1000;

async function computeCompetitionBoard(): Promise<CompetitionBoard> {
  const sb = getServiceRoleClient();

  // PAGINATED, and it is not optional — the table holds 1,158 cells, already past the cap.
  // The rents board shipped unpaginated and silently served only the first 1000 rows ordered
  // by price, i.e. the most expensive fifth of Ontario, with nothing erroring. Ordering by a
  // stable key rather than a measure so pages cannot overlap or skip when two rows tie.
  const data: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await sb
      .from("sale_competition_stats")
      .select(
        "city, area, property_group, pct_over_ask, pct_at_ask, pct_under_ask, " +
          "median_sale_to_list, median_premium, median_discount, pct_cut_before_sale, " +
          "yoy_over_ask_pts, sample_count, prior_sample, computed_at"
      )
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { rows: [], summary: [], dataAsOf: null };
    if (!page || page.length === 0) break;
    data.push(...(page as unknown as Record<string, unknown>[]));
    if (page.length < PAGE) break;
  }
  if (data.length === 0) return { rows: [], summary: [], dataAsOf: null };

  let newest: string | null = null;
  const rows: CompetitionRow[] = [];
  const summary: CompetitionRow[] = [];

  for (const r of data) {
    const pctOverAsk = num(r.pct_over_ask);
    const group = String(r.property_group ?? "");
    if (pctOverAsk == null || (group !== "House" && group !== "Condo")) continue;

    const computed = typeof r.computed_at === "string" ? r.computed_at : null;
    if (computed && (!newest || computed > newest)) newest = computed;

    const rawCity = String(r.city ?? "");
    const rawArea = String(r.area ?? "");
    const isProvince = rawCity === PROVINCE_CITY && rawArea === "";
    const city = isProvince ? PROVINCE_CITY : displayCity(rawCity);

    const row: CompetitionRow = {
      city,
      area: isProvince ? "Ontario" : displayArea(rawArea, city),
      group,
      pctOverAsk,
      pctAtAsk: num(r.pct_at_ask),
      pctUnderAsk: num(r.pct_under_ask),
      medianSaleToList: num(r.median_sale_to_list),
      medianPremium: num(r.median_premium),
      medianDiscount: num(r.median_discount),
      pctCutBeforeSale: num(r.pct_cut_before_sale),
      yoyOverAskPts: num(r.yoy_over_ask_pts),
      sampleCount: num(r.sample_count) ?? 0,
      priorSample: num(r.prior_sample) ?? 0,
    };
    (isProvince ? summary : rows).push(row);
  }
  return { rows, summary, dataAsOf: newest };
}

/** Cached competition board (6h — the source refreshes nightly). */
export function getCompetitionBoard(): Promise<CompetitionBoard> {
  return unstable_cache(computeCompetitionBoard, ["data-competition-board", "v1"], {
    revalidate: 21600,
  })();
}

/** Uncached — for the nightly data-health canary (runs outside a Next request context). */
export function computeCompetitionBoardUncached(): Promise<CompetitionBoard> {
  return computeCompetitionBoard();
}
