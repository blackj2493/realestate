import type { MetadataRoute } from "next";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { searchListings } from "@/lib/typesense/client";
import { cityHubSlug, cityHubResolves } from "@/lib/listings/listingPath";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

// Refresh daily (matches the ETL cadence). Compliance: the `listings` table is the
// active IDX feed only — sold/VOW records live in raw_vow_sold and are never emitted.
export const revalidate = 86400;

const PAGE = 1000; // PostgREST hard-caps a single response at 1000 rows — must paginate
const MAX_URLS = 45_000; // headroom under the 50k-URL sitemap protocol limit
const HUB_MIN = 5; // don't sitemap a city hub that would render thin (the hub noindexes < 3)

/**
 * Crawlable city-hub URLs (/property/on/{city}) — the internal-link entry points to
 * listings (the Command Center is a client-only WebGL map Googlebot can't crawl). Built
 * from the Typesense City facet (active For-Sale only). Emits only hubs that round-trip
 * (cityHubResolves) with enough inventory; district-split cities (Toronto, London) come
 * online once 2b-ii's normalized CitySlug lands. Capped at the facet's top 50 cities
 * (max_facet_values) — the high-inventory markets. Best-effort: [] on any Typesense
 * failure, so the listing sitemap below is never affected.
 */
async function cityHubRoutes(): Promise<MetadataRoute.Sitemap> {
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: "TransactionType:=`For Sale` && PropertyType:!=Commercial",
      perPage: 1,
      facetBy: "City",
    });
    const facet = (res.facetDistribution?.City ?? {}) as Record<string, number>;
    const seen = new Set<string>();
    const routes: MetadataRoute.Sitemap = [];
    for (const [city, count] of Object.entries(facet)) {
      if (count < HUB_MIN || !cityHubResolves(city)) continue;
      const slug = cityHubSlug(city);
      if (seen.has(slug)) continue; // de-dupe (e.g. multiple raw values → one slug)
      seen.add(slug);
      routes.push({
        url: `${SITE_URL}/property/on/${slug}`,
        changeFrequency: "daily" as const,
        priority: 0.8,
      });
    }
    return routes;
  } catch {
    return [];
  }
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
