/**
 * The city set for the static study pages (sold prices, best time to sell, price change,
 * condo prices, basement value): the 15 board markets plus the cities that people search
 * for and that have enough sales in the feed. Chosen on 2026-11-24 from Google Trends
 * ("{city} real estate", Ontario, 12 months) and 2-year sales counts: each extra city has
 * 1,500+ sales. Windsor, Sudbury and Thunder Bay have the demand but too few sales.
 * 2026-11-25: 8 more cities with 1,100+ sales (North Bay left out: too few leases);
 * each build's own sample gates drop a section whose sample is too small.
 *
 * The live pages (housing market, days on market, good time to buy, not selling) read the
 * nightly region_metrics precompute, which covers only the board markets, so they keep
 * OUTLOOK_CITIES.
 */
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";
import { OTTAWA_AREAS } from "@/lib/dashboard/ottawaAreas";
import { cityHubSlug } from "@/lib/listings/listingPath";

/** City name -> the feed's City values, where they differ from the name. */
const CITY_AREAS: Record<string, string[]> = {
  London: ["London East", "London North", "London South"],
};

export const EXTRA_STUDY_CITIES: string[] = [
  "London",
  "Kitchener",
  "Barrie",
  "Guelph",
  "Kingston",
  "St. Catharines",
  "Cambridge",
  "Waterloo",
  "Peterborough",
  "Niagara Falls",
  "Brantford",
  // 2026-11-25: the next cities by 2-year sales (1,100+), so the study pages reach 34.
  "Clarington",
  "Kawartha Lakes",
  "Newmarket",
  "Caledon",
  "Welland",
  "Belleville",
  "Woodstock",
  "Aurora",
];

export const STUDY_CITIES: { city: string; slug: string }[] = [
  ...OUTLOOK_CITIES,
  ...EXTRA_STUDY_CITIES.map((city) => ({ city, slug: cityHubSlug(city) })),
];

export function studyCityBySlug(slug: string): { city: string; slug: string } | null {
  return STUDY_CITIES.find((c) => c.slug === slug.toLowerCase()) ?? null;
}

/**
 * SQL that keeps one city's rows of raw_vow_sold. Toronto = every "Toronto C01…W10" City
 * value; Ottawa = OTTAWA_AREAS; London = its three districts; else the City value itself.
 * `param` is the number of the first free $n placeholder.
 */
export function studyCityFilter(city: string, param: number): { sql: string; params: unknown[] } {
  if (city === "Toronto") return { sql: `city like 'Toronto %'`, params: [] };
  if (city === "Ottawa") return { sql: `city = any($${param}::text[])`, params: [OTTAWA_AREAS] };
  if (CITY_AREAS[city]) return { sql: `city = any($${param}::text[])`, params: [CITY_AREAS[city]] };
  return { sql: `city = $${param}`, params: [city] };
}

/**
 * The comparison group for the similar-home models: the feed's community, else the postal
 * area (FSA). Kitchener, Cambridge, Waterloo and Brantford come with no community at all;
 * the FSA is a coarser but real neighbourhood. Not for display: pages that list communities
 * read city_region itself.
 */
export const MODEL_HOOD_SQL = `coalesce(nullif(city_region,''), 'FSA ' || nullif(left(postal_code,3),''), '')`;

/**
 * The study city (its slug) that a feed City value belongs to, else null: "Toronto C01" ->
 * toronto, an Ottawa area -> ottawa, "London North" -> london, "Kawartha Lakes" ->
 * kawartha-lakes. For the "More about {city}" links on address and listing pages.
 */
export function studyCitySlugForFeedCity(feedCity: string | null | undefined): string | null {
  const v = feedCity?.trim();
  if (!v) return null;
  if (v === "Toronto" || v.startsWith("Toronto ")) return "toronto";
  if (OTTAWA_AREAS.includes(v)) return "ottawa";
  const area = Object.entries(CITY_AREAS).find(([, values]) => values.includes(v));
  const name = (area ? area[0] : v).toLowerCase();
  return STUDY_CITIES.find((c) => c.city.toLowerCase() === name)?.slug ?? null;
}
