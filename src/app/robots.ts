import type { MetadataRoute } from "next";
import { SLOWED_CRAWLERS } from "@/lib/seo/trainingCrawlers";
import { ADDRESS_SITEMAP_SHARDS } from "@/lib/sold/addressSitemapShards";
import { LISTING_SITEMAP_SHARDS } from "@/lib/listings/listingSitemapShards";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

const DISALLOW = ["/api/", "/dashboard", "/login", "/register", "/apply", "/share/"];

/**
 * Bulk AI-training crawlers, slowed — not blocked (src/lib/seo/trainingCrawlers.ts has the
 * 2026-11-24 incident). Crawl-delay is non-standard: Anthropic documents that ClaudeBot
 * honours it; the others may ignore it, and middleware.ts also sheds them on the
 * Typesense-heavy pages. A named group REPLACES the "*" group for that bot, so it repeats
 * DISALLOW.
 */
export { SLOWED_CRAWLERS };
export const CRAWL_DELAY_SECONDS = 2;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      { userAgent: SLOWED_CRAWLERS, allow: "/", disallow: DISALLOW, crawlDelay: CRAWL_DELAY_SECONDS },
    ],
    // The /address tree is sharded (generateSitemaps in app/addresses/sitemap.ts) —
    // the protocol caps one file at 50,000 URLs. Every shard has to be named here or
    // Google never fetches it, so the count comes from the module the route uses too.
    //
    // /data/sitemap.xml is separate from the root file on purpose (see app/data/sitemap.ts):
    // Search Console reports coverage per sitemap, and eleven high-value pages mixed into
    // ~47,600 listing URLs could not be observed. Submit it in Search Console as well —
    // declaring it here gets it crawled, but only a submitted sitemap gets a coverage row.
    // Listings are sharded too, and for the harder reason: /sitemap.xml had reached
    // 47,646 of the 50,000 cap, where Google rejects the WHOLE file and every hub in it
    // goes undiscovered with a green build. Same one-module-two-importers rule as above.
    sitemap: [
      `${SITE_URL}/sitemap.xml`,
      `${SITE_URL}/data/sitemap.xml`,
      ...Array.from({ length: LISTING_SITEMAP_SHARDS }, (_, i) => `${SITE_URL}/listings/sitemap/${i}.xml`),
      ...Array.from({ length: ADDRESS_SITEMAP_SHARDS }, (_, i) => `${SITE_URL}/addresses/sitemap/${i}.xml`),
    ],
    host: SITE_URL,
  };
}
