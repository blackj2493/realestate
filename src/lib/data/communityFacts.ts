/**
 * Neighbourhood market facts — the community-level twin of cityFacts.ts.
 *
 * Same purpose (one self-contained, dated, sourced sentence per fact, quotable by an AI
 * assistant), same output shape (CityFacts, so the one CityMarketFacts block renders both),
 * and the same definitions: the community_market_facts precompute (migration 163) copies
 * the region RPCs. A fact is dropped when its sample is thin.
 *
 * Pure and deterministic (no IO). The loader is getCommunityFacts below.
 */
import { getServiceRoleClient } from "@/lib/supabase/client";
import type { CityFact, CityFacts } from "./cityFacts";

export interface CommunityFactsRow {
  city: string;
  city_region: string;
  sales_12m: number;
  median_price: number | null;
  gap_sample: number;
  under_ask_share: number | null;
  ask_gap_median: number | null;
  dom_sample: number;
  median_dom: number | null;
  active_count: number;
  cut_share: number | null;
  median_cut_pct: number | null;
  median_true_dom: number | null;
  computed_at: string;
}

/** Sold-side facts need 30 sales in 12 months; active-side facts need 15 homes for sale. */
export const MIN_SOLD = 30;
export const MIN_ACTIVE = 15;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const pct0 = (n: number) => `${Math.round(n)}%`;
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function buildCommunityFacts(hood: string, city: string, row: CommunityFactsRow | null): CityFacts | null {
  if (!row || !row.computed_at) return null;
  const place = `${hood}, ${city}`;
  const facts: CityFact[] = [];

  const sales = num(row.sales_12m) ?? 0;
  const gapN = num(row.gap_sample) ?? 0;
  const domN = num(row.dom_sample) ?? 0;
  const active = num(row.active_count) ?? 0;
  const medianPrice = num(row.median_price);
  const under = num(row.under_ask_share);
  const gap = num(row.ask_gap_median);
  const dom = num(row.median_dom);
  const cut = num(row.cut_share);
  const cutPct = num(row.median_cut_pct);
  const trueDom = num(row.median_true_dom);

  if (medianPrice != null && sales >= MIN_SOLD) {
    facts.push({
      id: "price",
      text: `The median sale price of all home types in ${place} was ${usd(medianPrice)} over the last 12 months (${sales.toLocaleString("en-CA")} sales).`,
      measure: { name: "Median sale price, all home types, last 12 months", value: medianPrice, unitText: "CAD" },
    });
  }
  if (under != null && gapN >= MIN_SOLD) {
    facts.push({
      id: "under_first_ask",
      text:
        `In the last 12 months, ${pct0(under * 100)} of homes in ${place} sold for less than their first asking price (${gapN.toLocaleString("en-CA")} sales)` +
        (gap != null ? `; the median sale was ${pct1(Math.abs(gap))} ${gap < 0 ? "below" : "above"} the first asking price.` : "."),
      measure: { name: "Share of homes sold below the first asking price, last 12 months", value: Math.round(under * 1000) / 10, unitText: "percent" },
    });
  }
  if (dom != null && domN >= MIN_SOLD) {
    facts.push({
      id: "days_to_sell",
      text: `Homes in ${place} that sold in the last 12 months were on the market for a median of ${Math.round(dom)} days.`,
      measure: { name: "Median days on market of sold homes, last 12 months", value: Math.round(dom), unitText: "days" },
    });
  }
  if (cut != null && active >= MIN_ACTIVE) {
    facts.push({
      id: "price_cuts",
      text:
        `Of the ${active.toLocaleString("en-CA")} homes for sale in ${place} now, ${pct0(cut * 100)} have cut their asking price` +
        (cutPct != null && cut > 0 ? `; the median cut is ${pct1(cutPct)}.` : "."),
      measure: { name: "Share of homes for sale with a price cut", value: Math.round(cut * 1000) / 10, unitText: "percent" },
    });
  }
  if (trueDom != null && active >= MIN_ACTIVE) {
    facts.push({
      id: "true_dom",
      text: `Homes for sale in ${place} now have been on the market for a median of ${Math.round(trueDom)} days when relists are counted as one listing.`,
      measure: { name: "Median true days on market of homes for sale (relists joined)", value: Math.round(trueDom), unitText: "days" },
    });
  }

  if (!facts.length) return null;

  const updatedLabel = new Date(row.computed_at).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Toronto" });
  const parts = [
    medianPrice != null && sales >= MIN_SOLD ? `median sale price ${usd(medianPrice)} (12 mo)` : null,
    under != null && gapN >= MIN_SOLD ? `${pct0(under * 100)} sold below first asking` : null,
    dom != null && domN >= MIN_SOLD ? `median ${Math.round(dom)} days to sell` : null,
  ].filter(Boolean);

  return {
    city: place,
    facts,
    faqs: [],
    updatedLabel,
    updatedIso: new Date(row.computed_at).toISOString(),
    summary: parts.length ? `${place} market: ${parts.join("; ")}. Updated ${updatedLabel}.` : null,
  };
}

/**
 * The community row for a hub, by its raw TRREB City values and CityRegion value(s).
 * When a slug matches more than one row (a community split across Toronto districts), the
 * row with the most sales wins. null on no row or any failure: the block is optional.
 */
export async function getCommunityFacts(cities: string[], regions: string[]): Promise<CommunityFactsRow | null> {
  if (cities.length === 0 || regions.length === 0) return null;
  try {
    const { data, error } = await getServiceRoleClient()
      .from("community_market_facts")
      .select("*")
      .in("city", cities)
      .in("city_region", regions)
      .order("sales_12m", { ascending: false })
      .order("active_count", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as CommunityFactsRow | null) ?? null;
  } catch (err) {
    console.error("[getCommunityFacts] failed:", err);
    return null;
  }
}
