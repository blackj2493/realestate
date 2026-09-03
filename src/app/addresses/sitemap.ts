import type { MetadataRoute } from "next";
import { getSoldSitemapEntries } from "@/lib/sold/soldByKey";
import { buildAddressPath } from "@/lib/listings/listingPath";

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
    // Same builder the in-page links use — a sitemap URL the links can't reproduce is
    // what made this sitemap the address tree's ONLY crawl path (see buildAddressPath).
    const path = buildAddressPath(e);
    if (!path) continue;
    out.push({
      url: `${SITE_URL}${path}`,
      changeFrequency: "monthly",
      priority: 0.5,
    });
  }
  return out;
}
