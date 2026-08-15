/**
 * Rent board — server-side data for the public /data/rents tracker.
 *
 * Reads cells precomputed nightly by scripts/admin/refresh-rent-market-stats.ts
 * (migration 119) from CLOSED lease prices — what a tenant actually signed, not what a
 * landlord asked.
 *
 * WHY THIS TRACKER EXISTS: no Canadian source publishes what a HOUSE rents for. TRREB's
 * quarterly rental report is condo apartments only; Zumper/PadMapper/RentCafe carry asking
 * rents; CMHC covers purpose-built stock annually. Houses closing on MLS® are the gap.
 *
 * SHAPED FOR A READER, NOT FOR COVERAGE. The first version returned one row per
 * neighbourhood sorted by sample_count — an internal quality metric leaking into the
 * reader's view — and hid the per-bedroom rows entirely. Nobody asks "what is the median
 * rent across all bedroom counts here"; they ask what a THREE-BED costs. So this returns
 * every bedroom band and the page selects, and `summary` carries the province-wide figures
 * that make a one-sentence finding possible without scrolling a thousand rows.
 *
 * Aggregate statistics only — no listing rows, ever.
 */
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { cityHubSlug, deslugCity } from "@/lib/listings/listingPath";

export type RentGroup = "House" | "Condo";
/** '1' | '2' | '3' | '4' (4 = 4 or more) | 'ALL'. */
export type BedBand = "1" | "2" | "3" | "4" | "ALL";

/** Reserved key for the province-wide rollup written by the refresh job. */
const PROVINCE_CITY = "Ontario";

export interface RentRow {
  city: string;
  area: string;
  group: RentGroup;
  beds: BedBand;
  medianRent: number;
  p25Rent: number | null;
  p75Rent: number | null;
  /** Only meaningful on the ALL band, where the median spans mixed bedroom counts. */
  medianBedrooms: number | null;
  yoyPct: number | null;
  sampleCount: number;
  priorSample: number;
}

export interface RentBoard {
  /** Neighbourhood cells, every bedroom band. The page filters. */
  rows: RentRow[];
  /** Province-wide figures — the headline strip. */
  summary: RentRow[];
  dataAsOf: string | null;
}

/** Below this a row is shown but marked, so a reader can discount it themselves. */
export const THIN_SAMPLE = 10;
/**
 * A year-over-year move is only offered as a RANKING when both windows are this thick.
 * The stored figure already requires 20; ranking is where a thin cell does real damage,
 * because "biggest faller" is the most quotable and least robust cut on the page.
 */
export const MOVER_MIN_SAMPLE = 30;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * TRREB stores Toronto as district codes ("Toronto C02"), meaningless to a public reader.
 * Round-trip through the canonical hub-slug helpers so districts consolidate to their
 * municipality using the same rules as the hub tree, not a second copy of that regex.
 */
function displayCity(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const slug = cityHubSlug(trimmed);
  return slug ? deslugCity(slug) : trimmed;
}

/**
 * Make a TRREB area name readable.
 *
 * 308 of 1,033 distinct areas carry an MLS district code the feed never strips, in two
 * shapes: "057 - Smithville", and Oakville/Ottawa's "1011 - MO Morrison" where a two-letter
 * district abbreviation follows the number. Neither means anything to a renter or a
 * reporter, and "1011 - MO Morrison" in a published table looks like a database leak.
 *
 * The two-letter strip is applied ONLY when a numeric prefix was present — that is what
 * marks the name as coded. Doing it unconditionally would eat the opening word of any
 * legitimately capitalised name.
 *
 * Verified against the full distinct set: nothing strips to empty, and the shortest results
 * (Carp, Glebe, Perth, Finch, Ascot, Town) are real neighbourhood names, not fragments.
 */
export function cleanAreaName(raw: string): string {
  const a = raw.trim();
  const withoutCode = a.replace(/^\d{3,4}\s*-\s*/, "");
  if (withoutCode === a) return a;
  const withoutAbbrev = withoutCode.replace(/^[A-Z]{2}\s+(?=\S)/, "");
  return withoutAbbrev || withoutCode || a;
}

/** Waterloo Region and Brantford arrive with no CityRegion; the city IS the area there. */
function displayArea(area: string, city: string): string {
  const a = cleanAreaName(area);
  return a || `${city} (all areas)`;
}

const isBand = (v: string): v is BedBand => ["1", "2", "3", "4", "ALL"].includes(v);

/** PostgREST hard-caps a single response at 1000 rows — must paginate. */
const PAGE = 1000;

async function computeRentBoard(): Promise<RentBoard> {
  const sb = getServiceRoleClient();

  // PAGINATED, and it is not optional. The table holds ~4,900 cells; a single unpaginated
  // select silently returned the first 1000 ordered by median_rent, i.e. ONLY the most
  // expensive fifth of Ontario. The page rendered a headline strip that was mostly dashes
  // (8 of 10 province rows fell outside the cap) over a table that opened on $9,650 Rosedale
  // houses, with everything under $3,100 invisible. Nothing errored. Ordering by a stable
  // key rather than median_rent so pages cannot overlap or skip if two rows tie.
  const data: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await sb
      .from("rent_market_stats")
      .select(
        "city, area, property_group, bedrooms_band, median_rent, p25_rent, p75_rent, " +
          "median_bedrooms, yoy_pct, sample_count, prior_sample, computed_at"
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
  const rows: RentRow[] = [];
  const summary: RentRow[] = [];

  for (const r of data) {
    const medianRent = num(r.median_rent);
    const group = String(r.property_group ?? "");
    const band = String(r.bedrooms_band ?? "");
    if (medianRent == null || (group !== "House" && group !== "Condo") || !isBand(band)) continue;

    const computed = typeof r.computed_at === "string" ? r.computed_at : null;
    if (computed && (!newest || computed > newest)) newest = computed;

    const rawCity = String(r.city ?? "");
    const rawArea = String(r.area ?? "");
    const isProvince = rawCity === PROVINCE_CITY && rawArea === "";
    const city = isProvince ? PROVINCE_CITY : displayCity(rawCity);

    const row: RentRow = {
      city,
      area: isProvince ? "Ontario" : displayArea(rawArea, city),
      group,
      beds: band,
      medianRent,
      p25Rent: num(r.p25_rent),
      p75Rent: num(r.p75_rent),
      medianBedrooms: num(r.median_bedrooms),
      yoyPct: num(r.yoy_pct),
      sampleCount: num(r.sample_count) ?? 0,
      priorSample: num(r.prior_sample) ?? 0,
    };
    (isProvince ? summary : rows).push(row);
  }
  return { rows, summary, dataAsOf: newest };
}

/** Cached rent board (6h — the source refreshes nightly). */
export function getRentBoard(): Promise<RentBoard> {
  return unstable_cache(computeRentBoard, ["data-rent-board", "v2"], { revalidate: 21600 })();
}

/** Uncached — for the nightly data-health canary (runs outside a Next request context). */
export function computeRentBoardUncached(): Promise<RentBoard> {
  return computeRentBoard();
}
