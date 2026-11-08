/**
 * The city set and slugs for /data/housing-market/{city} — the 15 board markets, slugged
 * like the city hubs (/property/on/{slug}). One module so the page, the index, the sitemap,
 * IndexNow and llms.txt can never disagree on the list.
 */
import { REGION_TO_CITIES, citiesFromRegions } from "@/lib/dashboard/config";
import { cityHubSlug } from "@/lib/listings/listingPath";

export const OUTLOOK_CITIES: { city: string; slug: string }[] = citiesFromRegions(Object.keys(REGION_TO_CITIES)).map((city) => ({
  city,
  slug: cityHubSlug(city),
}));

export function outlookCityBySlug(slug: string): string | null {
  return OUTLOOK_CITIES.find((c) => c.slug === slug.toLowerCase())?.city ?? null;
}

export const outlookPath = (slug: string) => `/data/housing-market/${slug}`;
