import type { MetadataRoute } from "next";
import { getServiceRoleClient } from "@/lib/supabase/client";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://pureproperty.ca").replace(/\/$/, "");

// Refresh daily (matches the ETL cadence). Compliance: the `listings` table is the
// active IDX feed only — sold/VOW records live in raw_vow_sold and are never emitted.
export const revalidate = 86400;

const PAGE = 1000; // PostgREST hard-caps a single response at 1000 rows — must paginate
const MAX_URLS = 45_000; // headroom under the 50k-URL sitemap protocol limit

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/properties`, changeFrequency: "hourly", priority: 0.9 },
  ];

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
    if (rows.length === 0) return staticRoutes;

    const listingRoutes: MetadataRoute.Sitemap = rows
      .slice(0, MAX_URLS)
      .filter((row) => row.listing_key)
      .map((row) => ({
        url: `${SITE_URL}/properties/${row.listing_key}`,
        lastModified: row.synced_at ? new Date(row.synced_at) : undefined,
        changeFrequency: "daily" as const,
        priority: 0.7,
      }));

    return [...staticRoutes, ...listingRoutes];
  } catch {
    // Missing env at build / DB unavailable — still emit the static routes.
    return staticRoutes;
  }
}
