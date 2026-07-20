import type { MetadataRoute } from "next";
import { getServiceRoleClient } from "@/lib/supabase/client";
import {
  cityHubsWithInventory,
  neighbourhoodHubsForSitemap,
  COMMERCIAL_ACTIVE_FILTER,
} from "@/lib/listings/cityHubs";
import { LIVE_TRACKERS } from "@/lib/data/trackers";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

// Refresh daily (matches the ETL cadence). NOTE: `listings` is NOT active-only — Query B
// upserts Closed (sold) payloads here, and Terminated/Expired/Suspended rows stay
// frozen-Active — so this sitemap DOES emit their /properties/{key} URLs. That is safe:
// the listing page resolves the TRUE status and sets robots:noindex for every non-active
// listing (see properties/[id] generateMetadata), so sold/off-market pages are
// discoverable but never indexed, and all VOW numbers (close price, sold DOM) are gated
// at render. If you ever need to stop emitting them entirely, filter here by resolved
// status (anti-join raw_vow_delisted for the frozen-Active terminated rows).
export const revalidate = 86400;

const PAGE = 1000; // PostgREST hard-caps a single response at 1000 rows — must paginate
const MAX_URLS = 45_000; // headroom under the 50k-URL sitemap protocol limit
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

  // Public /data trackers (hub + each live tracker). Aggregate-statistics pages, emitted
  // regardless of DB state (like the static routes).
  const dataRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/data`, changeFrequency: "daily", priority: 0.8 },
    ...LIVE_TRACKERS.map((t) => ({
      url: `${SITE_URL}/data/${t.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];

  const hubRoutes = await cityHubRoutes();

  try {
    const supabase = getServiceRoleClient();
    const rows: { listing_key: string | null; synced_at: string | null }[] = [];
    for (let from = 0; rows.length < MAX_URLS; from += PAGE) {
      const { data, error } = await supabase
        .from("listings")
        .select("listing_key, synced_at")
        .order("synced_at", { ascending: false })
        .order("listing_key") // deterministic tie-break so range pagination never skips/dups
        .range(from, from + PAGE - 1);
      if (error || !data) break;
      rows.push(...data);
      if (data.length < PAGE) break;
    }

    const listingRoutes: MetadataRoute.Sitemap = rows
      .slice(0, MAX_URLS)
      .filter((row) => row.listing_key)
      .map((row) => ({
        url: `${SITE_URL}/properties/${row.listing_key}`,
        lastModified: row.synced_at ? new Date(row.synced_at) : undefined,
        changeFrequency: "daily" as const,
        priority: 0.7,
      }));

    return [...staticRoutes, ...dataRoutes, ...hubRoutes, ...listingRoutes];
  } catch {
    // Missing env at build / DB unavailable — still emit the static + data + hub routes.
    return [...staticRoutes, ...dataRoutes, ...hubRoutes];
  }
}
