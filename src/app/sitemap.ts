import type { MetadataRoute } from "next";
import { getServiceRoleClient } from "@/lib/supabase/client";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://pureproperty.ca").replace(/\/$/, "");

// Refresh daily (matches the ETL cadence). Compliance: the `listings` table is the
// active IDX feed only — sold/VOW records live in raw_vow_sold and are never emitted.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/properties`, changeFrequency: "hourly", priority: 0.9 },
  ];

  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("listings")
      .select("listing_key, synced_at")
      .order("synced_at", { ascending: false })
      .limit(45000);

    if (error || !data) return staticRoutes;

    const listingRoutes: MetadataRoute.Sitemap = data
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
