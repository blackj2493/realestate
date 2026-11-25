import type { MetadataRoute } from "next";
import { ADDRESS_SITEMAP_SHARDS } from "@/lib/sold/addressSitemapShards";
import { LISTING_SITEMAP_SHARDS } from "@/lib/listings/listingSitemapShards";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

const DISALLOW = ["/api/", "/dashboard", "/login", "/register", "/apply", "/share/"];

/**
 * Bulk AI-training crawlers, slowed — not blocked.
 *
 * On 2026-11-24 ClaudeBot alone made 269K requests in 12 hours (GPTBot 45K,
 * meta-webindexer 32K), mostly to /address/... pages. Those pages are
 * force-dynamic and each one runs Typesense searches, so the crawl held the
 * Typesense cluster at 100% CPU (search p95 1.7s for real users) and drove
 * ~5 Vercel function invocations a second.
 *
 * Crawl-delay is non-standard: Anthropic documents that ClaudeBot honours it;
 * the others may ignore it. The AI *search/assistant* agents (Claude-SearchBot,
 * OAI-SearchBot, ChatGPT-User, PerplexityBot) are deliberately NOT listed, so
 * AI-search citation keeps working at full speed.
 *
 * A named group REPLACES the "*" group for that bot, so it repeats DISALLOW.
 */
export const SLOWED_CRAWLERS = ["ClaudeBot", "GPTBot", "meta-webindexer", "meta-externalagent"];
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
