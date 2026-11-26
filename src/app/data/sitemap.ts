import type { MetadataRoute } from "next";
import { LIVE_TRACKERS } from "@/lib/data/trackers";
import { OUTLOOK_CITIES, outlookPath } from "@/lib/data/outlookCities";
import { getCityMarkets } from "@/lib/data/cityMarkets";
import { daysOnMarketPath } from "@/lib/seo/cityTopics";
import { basementValuePath, getBasementData } from "@/lib/data/basementValue";
import { CHILD_CARE_PATH, getChildCareData } from "@/lib/childcare/childCarePage";
import { LIVE_FINDINGS } from "@/lib/data/findings";
import { getPriceChangeData, priceChangePath } from "@/lib/data/priceChange";
import { condoPricesPath, getCondoData } from "@/lib/data/condoPrices";
import { getTaxData, propertyTaxPath } from "@/lib/data/propertyTax";
import { goodTimeToBuyPath } from "@/lib/data/goodTimeToBuy";
import { rentVsBuyPath } from "@/lib/data/rentVsBuy";
import { getSchoolData, schoolPricesPath } from "@/lib/data/schoolPrices";
import { getSoldData, soldPricesPath } from "@/lib/data/soldPrices";
import { getBestTimeData, bestTimeToSellPath } from "@/lib/data/bestTimeToSell";

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
  // Trackers and city market pages are rebuilt from the nightly sync, so "now" is a true
  // lastmod for them (added 2026-11-09; Bing reads lastmod as a freshness signal for AI
  // answers). Findings keep their own date and the press desk keeps none — see below.
  const now = new Date();
  return [
    { url: `${SITE_URL}/data`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    // The press desk. Rarely changes, but it is the page every outreach email points at,
    // so it must be indexable and discoverable rather than a hidden landing page.
    { url: `${SITE_URL}/data/for-journalists`, changeFrequency: "monthly", priority: 0.6 },
    ...LIVE_TRACKERS.map((t) => ({
      url: `${SITE_URL}/data/${t.slug}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    // Findings: dated analysis built on the trackers. lastModified is the piece's own
    // date rather than "now" — a finding is a snapshot, and claiming daily freshness on
    // static analysis is the kind of thing that gets a sitemap discounted.
    // City housing-market pages ("{city} housing market 2027" — the most-searched housing query).
    { url: `${SITE_URL}/data/housing-market`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    ...OUTLOOK_CITIES.map((c) => ({ url: `${SITE_URL}${outlookPath(c.slug)}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.8 })),
    ...getCityMarkets().cities.map((c) => ({ url: `${SITE_URL}${outlookPath(c.slug)}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 })),
    // "How long does it take to sell a house in {city}" + best month (2026-11-10).
    ...OUTLOOK_CITIES.map((c) => ({ url: `${SITE_URL}${daysOnMarketPath(c.slug)}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.7 })),
    ...getCityMarkets().cities.map((c) => ({ url: `${SITE_URL}${daysOnMarketPath(c.slug)}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.7 })),
    // "Does a finished basement add value in {city}?" (2026-11-24). Static, rebuilt monthly.
    { url: `${SITE_URL}${basementValuePath()}`, lastModified: new Date(getBasementData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 },
    ...getBasementData()
      .cities.filter((c) => c.modelA)
      .map((c) => ({ url: `${SITE_URL}${basementValuePath(c.slug)}`, lastModified: new Date(getBasementData().generatedAt), changeFrequency: "monthly" as const, priority: 0.7 })),
    // Toronto child care spaces per child, by neighbourhood (2026-11-25). Static, rebuilt weekly.
    { url: `${SITE_URL}${CHILD_CARE_PATH}`, lastModified: new Date(`${getChildCareData().updated}T12:00:00Z`), changeFrequency: "weekly" as const, priority: 0.7 },
    // "Are home prices dropping in {city}?" same-home change (2026-11-25). Static, rebuilt monthly.
    { url: `${SITE_URL}${priceChangePath()}`, lastModified: new Date(getPriceChangeData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 },
    ...getPriceChangeData()
      .cities.filter((c) => c.all)
      .map((c) => ({ url: `${SITE_URL}${priceChangePath(c.slug)}`, lastModified: new Date(getPriceChangeData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 })),
    // "{city} condo prices {year}": price, $/sq ft, fees by unit and community (2026-11-25). Static, monthly.
    { url: `${SITE_URL}${condoPricesPath()}`, lastModified: new Date(getCondoData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 },
    ...getCondoData().cities.map((c) => ({ url: `${SITE_URL}${condoPricesPath(c.slug)}`, lastModified: new Date(getCondoData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 })),
    // "How much is property tax in {city}": the tax bill on sold listings by home type and community (2026-11-26). Static, monthly.
    { url: `${SITE_URL}${propertyTaxPath()}`, lastModified: new Date(getTaxData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 },
    ...getTaxData().cities.map((c) => ({ url: `${SITE_URL}${propertyTaxPath(c.slug)}`, lastModified: new Date(getTaxData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 })),
    // "Is it a good time to buy a house in {city}?" measured signals (2026-11-25). Board-backed, daily.
    { url: `${SITE_URL}${goodTimeToBuyPath()}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.8 },
    ...OUTLOOK_CITIES.map((c) => ({ url: `${SITE_URL}${goodTimeToBuyPath(c.slug)}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.8 })),
    ...getCityMarkets().cities.map((c) => ({ url: `${SITE_URL}${goodTimeToBuyPath(c.slug)}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 })),
    ...OUTLOOK_CITIES.map((c) => ({ url: `${SITE_URL}${rentVsBuyPath(c.slug)}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.7 })),
    ...getCityMarkets().cities.map((c) => ({ url: `${SITE_URL}${rentVsBuyPath(c.slug)}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.7 })),
    // "Do better schools raise house prices in {city}?" + every catchment (2026-11-25). Static, monthly.
    { url: `${SITE_URL}${schoolPricesPath()}`, lastModified: new Date(getSchoolData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 },
    ...getSchoolData().cities.map((c) => ({ url: `${SITE_URL}${schoolPricesPath(c.slug)}`, lastModified: new Date(getSchoolData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 })),
    // "{city} sold prices": medians by type, bedrooms and community (2026-11-25). Static, monthly.
    { url: `${SITE_URL}${soldPricesPath()}`, lastModified: new Date(getSoldData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 },
    ...getSoldData().cities.map((c) => ({ url: `${SITE_URL}${soldPricesPath(c.slug)}`, lastModified: new Date(getSoldData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 })),
    // "Best time to sell a house in {city}": price, speed and over-asking by month (2026-11-24). Static, monthly.
    { url: `${SITE_URL}${bestTimeToSellPath()}`, lastModified: new Date(getBestTimeData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 },
    ...getBestTimeData().cities.map((c) => ({ url: `${SITE_URL}${bestTimeToSellPath(c.slug)}`, lastModified: new Date(getBestTimeData().generatedAt), changeFrequency: "monthly" as const, priority: 0.8 })),
    // Monthly Ontario Power of Sale Index (2026-11-10). Editions are linked from the hub page.
    { url: `${SITE_URL}/data/power-of-sale-index`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/data/findings`, changeFrequency: "weekly", priority: 0.7 },
    ...LIVE_FINDINGS.map((f) => ({
      url: `${SITE_URL}/data/findings/${f.slug}`,
      lastModified: new Date(`${f.updated ?? f.published}T12:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
