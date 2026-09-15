import type { MetadataRoute } from "next";
import {
  cityHubsWithInventory,
  neighbourhoodHubsForSitemap,
  COMMERCIAL_ACTIVE_FILTER,
} from "@/lib/listings/cityHubs";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

// Refresh daily (matches the ETL cadence).
//
// This file declares the STATIC and HUB routes ONLY. Listing URLs moved to
// src/app/listings/sitemap.ts and the /data tree to src/app/data/sitemap.ts, both on
// 2026-09-15, because this file had reached 47,646 of the protocol's 50,000-URL cap —
// where Google rejects the entire file rather than the overflow. The note about sold and
// terminated listings being emitted-but-noindexed moved with them, to the listings file.
export const revalidate = 86400;

const HUB_MIN = 5; // don't sitemap a city hub that would render thin (the hub noindexes < 3)

/**
 * Crawlable city-hub URLs (/property/on/{city}) — the internal-link entry points to
 * listings (the Command Center is a client-only WebGL map Googlebot can't crawl).
 * cityHubsWithInventory groups the Typesense City facet by normalized slug, so
 * district-split cities (Toronto C0x, London S/N/E) consolidate into one hub each, with
 * only hubs that clear HUB_MIN active listings emitted. Best-effort ([] on any Typesense
 * failure), so the listing sitemap below is never affected.
 */
async function cityHubRoutes(): Promise<MetadataRoute.Sitemap> {
  // City hubs + the persona hubs (cap-rate investor 2c, top-schools 2d) + the
  // neighbourhood hubs (2e). City/persona hubs are each counted over their OWN
  // sub-population so we never sitemap a hub that would render thin/noindex; the
  // neighbourhood enumeration applies the same >= HUB_MIN floor per (city, region).
  const [cityHubs, capRateHubs, schoolHubs, walkableHubs, newBuildHubs, devHubs, hoodHubs, commercialHubs] = await Promise.all([
    cityHubsWithInventory(HUB_MIN),
    cityHubsWithInventory(HUB_MIN, "ExtrapolatedCapRate:>0"),
    cityHubsWithInventory(HUB_MIN, "BestSchoolScoreNearby:>0"),
    // Walkable filter MUST match the hub page's WALKABLE_KM (most-walkable/page.tsx).
    cityHubsWithInventory(HUB_MIN, "NearestGroceryKm:<=1.5"),
    // New-build filter MUST match NEW_BUILD_FILTER (new-construction/page.tsx).
    cityHubsWithInventory(HUB_MIN, "(ApproximateAge:=`New` || ApproximateAge:=`0-5`)"),
    // Dev filter MUST match PRIME_FILTER (development-potential/page.tsx).
    cityHubsWithInventory(HUB_MIN, "multi_unit_status:=`PRIME_CANDIDATE`"),
    neighbourhoodHubsForSitemap(HUB_MIN),
    // Commercial hub tree (commercial-gap Phase 2) — counted over its OWN population.
    cityHubsWithInventory(HUB_MIN, "", COMMERCIAL_ACTIVE_FILTER),
  ]);
  return [
    ...cityHubs.map(({ slug }) => ({
      url: `${SITE_URL}/property/on/${slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...capRateHubs.map(({ slug }) => ({
      url: `${SITE_URL}/investments/${slug}/highest-cap-rate`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...schoolHubs.map(({ slug }) => ({
      url: `${SITE_URL}/family/${slug}/top-rated-schools`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...walkableHubs.map(({ slug }) => ({
      url: `${SITE_URL}/lifestyle/${slug}/most-walkable`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...newBuildHubs.map(({ slug }) => ({
      url: `${SITE_URL}/lifestyle/${slug}/new-construction`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...devHubs.map(({ slug }) => ({
      url: `${SITE_URL}/investments/${slug}/development-potential`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...hoodHubs.map(({ citySlug, hoodSlug }) => ({
      url: `${SITE_URL}/property/on/${citySlug}/${hoodSlug}`,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
    ...commercialHubs.map(({ slug }) => ({
      url: `${SITE_URL}/commercial/on/${slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/properties`, changeFrequency: "hourly", priority: 0.9 },
    // /property = the crawlable city directory (top of the hub tree); /properties is the
    // client-only terminal Googlebot can't crawl.
    { url: `${SITE_URL}/property`, changeFrequency: "daily", priority: 0.9 },
  ];

  // The /data trackers and findings MOVED OUT of this file to src/app/data/sitemap.ts
  // (/data/sitemap.xml) on 2026-09-15. Search Console reports coverage per sitemap, and
  // eleven high-value pages mixed into ~47,600 listing URLs were unobservable — the
  // "discovered" count told us nothing about whether any of them had ever been crawled.
  // They are declared in robots.ts alongside this file. Do not re-add them here: two
  // sitemaps claiming the same URL is not an error, but it puts the number you are trying
  // to read back out of reach.

  // Listing URLs MOVED OUT of this file to src/app/listings/sitemap.ts
  // (/listings/sitemap/{n}.xml) on 2026-09-15. This file had reached 47,646 of the
  // protocol's 50,000-URL cap, and at the cap Google rejects the ENTIRE file — not the
  // overflow — so every hub in here would have stopped being discovered at once, with a
  // green build and no error anywhere. Listings are the part that grows with market
  // activity, so listings are the part that left; this file is now ~28,900 and stable.
  //
  // Do not re-add them. Two sitemaps claiming the same URL is not an error, but it makes
  // the per-sitemap coverage numbers in Search Console unreadable, which is half of why
  // the split was worth doing.
  const hubRoutes = await cityHubRoutes();

  return [...staticRoutes, ...hubRoutes];
}
