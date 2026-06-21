import type { MetadataRoute } from "next";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { cityHubsWithInventory, neighbourhoodHubsForSitemap } from "@/lib/listings/cityHubs";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

// Refresh daily (matches the ETL cadence). Compliance: the `listings` table is the
// active IDX feed only — sold/VOW records live in raw_vow_sold and are never emitted.
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
  const [cityHubs, capRateHubs, schoolHubs, walkableHubs, hoodHubs] = await Promise.all([
    cityHubsWithInventory(HUB_MIN),
    cityHubsWithInventory(HUB_MIN, "ExtrapolatedCapRate:>0"),
    cityHubsWithInventory(HUB_MIN, "BestSchoolScoreNearby:>0"),
    // Walkable filter MUST match the hub page's WALKABLE_KM (most-walkable/page.tsx).
    cityHubsWithInventory(HUB_MIN, "NearestGroceryKm:<=1.5"),
    neighbourhoodHubsForSitemap(HUB_MIN),
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
    ...hoodHubs.map(({ citySlug, hoodSlug }) => ({
      url: `${SITE_URL}/property/on/${citySlug}/${hoodSlug}`,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/properties`, changeFrequency: "hourly", priority: 0.9 },
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

    return [...staticRoutes, ...hubRoutes, ...listingRoutes];
  } catch {
    // Missing env at build / DB unavailable — still emit the static + hub routes.
    return [...staticRoutes, ...hubRoutes];
  }
}
