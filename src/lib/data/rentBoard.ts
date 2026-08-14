/**
 * Rent board — server-side data for the public /data/rents tracker.
 *
 * Reads the neighbourhood cells precomputed nightly by
 * scripts/admin/refresh-rent-market-stats.ts (migration 119) from CLOSED lease prices —
 * what a tenant actually signed, not what a landlord asked.
 *
 * WHY THIS TRACKER EXISTS: no Canadian source publishes what a HOUSE rents for.
 * TRREB's quarterly rental report is condo apartments only; Zumper/PadMapper/RentCafe
 * carry asking rents; CMHC covers purpose-built stock annually. Houses closing on MLS®
 * are the gap, which is why `group` is a first-class dimension and the board defaults
 * to houses.
 *
 * Aggregate statistics only — no listing rows, ever.
 */
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { cityHubSlug, deslugCity } from "@/lib/listings/listingPath";

export type RentGroup = "House" | "Condo";

export interface RentRow {
  city: string;
  /** TRREB CityRegion. Empty for Waterloo Region/Brantford, where the feed ships none. */
  area: string;
  group: RentGroup;
  medianRent: number;
  p25Rent: number | null;
  p75Rent: number | null;
  /** Typical bedroom count behind the median — without it the median is uninterpretable. */
  medianBedrooms: number | null;
  /** Year-over-year change, %. NULL when either window was too thin to support one. */
  yoyPct: number | null;
  sampleCount: number;
  /** Share that closed BELOW the asking rent. Usually small — see the note on the page. */
  pctBelowAsk: number | null;
}

export interface RentBoard {
  rows: RentRow[];
  dataAsOf: string | null;
}

/** Below this we show the row but mark it as thin rather than letting it be read as solid. */
export const THIN_SAMPLE = 10;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * TRREB stores Toronto as district codes ("Toronto C02", "Toronto W08"), which mean nothing
 * to a public reader. Round-trip through the canonical hub-slug helpers so districts
 * consolidate to their municipality using the same rules as the hub tree, rather than a
 * second private copy of that regex.
 */
function displayCity(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const slug = cityHubSlug(trimmed);
  return slug ? deslugCity(slug) : trimmed;
}

/** Waterloo Region and Brantford arrive with no CityRegion at all; the city IS the area
 *  there, so label it plainly instead of rendering an empty cell. */
function displayArea(area: string, city: string): string {
  const a = area.trim();
  return a || `${city} (all areas)`;
}

async function computeRentBoard(): Promise<RentBoard> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("rent_market_stats")
    .select(
      "city, area, property_group, median_rent, p25_rent, p75_rent, median_bedrooms, " +
        "yoy_pct, sample_count, pct_below_ask, computed_at"
    )
    .eq("bedrooms_band", "ALL")
    .order("sample_count", { ascending: false });
  if (error || !data) return { rows: [], dataAsOf: null };

  let newest: string | null = null;
  const rows: RentRow[] = [];
  // Double cast, deliberately: rent_market_stats (migration 119) is not in the generated
  // Supabase types, so supabase-js falls back to GenericStringError[] and refuses the
  // direct assertion. Every field is re-validated through num()/String() below regardless,
  // so nothing here trusts the shape the cast claims.
  for (const r of data as unknown as Record<string, unknown>[]) {
    const medianRent = num(r.median_rent);
    const group = String(r.property_group ?? "");
    if (medianRent == null || (group !== "House" && group !== "Condo")) continue;

    const computed = typeof r.computed_at === "string" ? r.computed_at : null;
    if (computed && (!newest || computed > newest)) newest = computed;

    const city = displayCity(String(r.city ?? ""));
    rows.push({
      city,
      area: displayArea(String(r.area ?? ""), city),
      group,
      medianRent,
      p25Rent: num(r.p25_rent),
      p75Rent: num(r.p75_rent),
      medianBedrooms: num(r.median_bedrooms),
      yoyPct: num(r.yoy_pct),
      sampleCount: num(r.sample_count) ?? 0,
      pctBelowAsk: num(r.pct_below_ask),
    });
  }
  return { rows, dataAsOf: newest };
}

/** Cached rent board (6h — the source refreshes nightly). */
export function getRentBoard(): Promise<RentBoard> {
  return unstable_cache(computeRentBoard, ["data-rent-board", "v1"], { revalidate: 21600 })();
}

/** Uncached — for the nightly data-health canary (runs outside a Next request context). */
export function computeRentBoardUncached(): Promise<RentBoard> {
  return computeRentBoard();
}
