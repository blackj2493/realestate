import type { MetadataRoute } from "next";
import { getSoldSitemapEntries } from "@/lib/sold/soldByKey";
import { cityHubSlug, slugify } from "@/lib/listings/listingPath";

/**
 * /addresses/sitemap.xml — sitemap for the public /address (sold/off-market) pages.
 *
 * Uses Next's built-in sitemap.ts mechanism (same as the main app/sitemap.ts), NOT a
 * custom route handler: Next serves it as a properly-cached, non-chunked XML file that
 * Google's sitemap fetcher reliably reads. Sourced from the sold_listings rolling ~180-day
 * window via getSoldSitemapEntries (PUBLIC fields only — no VOW data). Capped under the
 * 50k-URL limit; best-effort ([] on failure).
 */
export const revalidate = 86400;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const MAX_URLS = 45_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries = await getSoldSitemapEntries(MAX_URLS);
  const out: MetadataRoute.Sitemap = [];
  for (const e of entries) {
    const citySlug = cityHubSlug(e.city) || slugify(e.city);
    if (!citySlug) continue; // can't build a clean URL without a city
    const street = slugify((e.address || "").split(",")[0]);
    const slug = street ? `${street}-${e.id}` : e.id;
    out.push({
      url: `${SITE_URL}/address/on/${citySlug}/${slug}`,
      changeFrequency: "monthly",
      priority: 0.5,
    });
  }
  return out;
}
