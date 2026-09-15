import type { MetadataRoute } from "next";
import { LIVE_TRACKERS } from "@/lib/data/trackers";
import { LIVE_FINDINGS } from "@/lib/data/findings";

/**
 * /data/sitemap.xml — the data desk's own sitemap, split out of the root one.
 *
 * WHY SPLIT. Two reasons, and the diagnostic one is the bigger.
 *
 * 1. VISIBILITY. Search Console reports coverage PER SITEMAP. Buried among 47,646 URLs
 *    in the root file, these eleven pages were unobservable: "47,646 discovered" said
 *    nothing about whether any /data page had ever been crawled, and on 2026-09-15
 *    /data/price-cuts turned out to be "unknown to Google" after two months in that
 *    file. In their own sitemap their indexing status is a number you can read.
 *
 * 2. HEADROOM. The root sitemap was at 47,646 of the protocol's 50,000-URL cap and grows
 *    with active inventory. At the cap Google rejects the ENTIRE file — not the overflow
 *    — and every page in it silently stops being discovered while the build stays green.
 *    Moving these out buys a little room; it does not solve that, and the root file still
 *    needs sharding before it tips.
 *
 * These entries are pure constants (no database), so this renders statically and cannot
 * fail the way a DB-backed sitemap can. No generateSitemaps() here on purpose: eleven
 * URLs need no sharding, and skipping it avoids the async-`id` foot-gun that has emptied
 * a sharded sitemap in this repo before.
 *
 * NOTE: adding a sitemap does not make Google crawl these pages — nothing in a sitemap
 * does. The in-content links (MarketDataLinks) and external citations are what earn the
 * crawl. This file is how you MEASURE whether that worked.
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/data`, changeFrequency: "daily", priority: 0.8 },
    // The press desk. Rarely changes, but it is the page every outreach email points at,
    // so it must be indexable and discoverable rather than a hidden landing page.
    { url: `${SITE_URL}/data/for-journalists`, changeFrequency: "monthly", priority: 0.6 },
    ...LIVE_TRACKERS.map((t) => ({
      url: `${SITE_URL}/data/${t.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    // Findings: dated analysis built on the trackers. lastModified is the piece's own
    // date rather than "now" — a finding is a snapshot, and claiming daily freshness on
    // static analysis is the kind of thing that gets a sitemap discounted.
    { url: `${SITE_URL}/data/findings`, changeFrequency: "weekly", priority: 0.7 },
    ...LIVE_FINDINGS.map((f) => ({
      url: `${SITE_URL}/data/findings/${f.slug}`,
      lastModified: new Date(`${f.updated ?? f.published}T12:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
