import type { MetadataRoute } from "next";
import { ADDRESS_SITEMAP_SHARDS } from "@/lib/sold/addressSitemapShards";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard",
          "/login",
          "/register",
          "/apply",
          "/share/",
        ],
      },
    ],
    // The /address tree is sharded (generateSitemaps in app/addresses/sitemap.ts) —
    // the protocol caps one file at 50,000 URLs. Every shard has to be named here or
    // Google never fetches it, so the count comes from the module the route uses too.
    //
    // /data/sitemap.xml is separate from the root file on purpose (see app/data/sitemap.ts):
    // Search Console reports coverage per sitemap, and eleven high-value pages mixed into
    // ~47,600 listing URLs could not be observed. Submit it in Search Console as well —
    // declaring it here gets it crawled, but only a submitted sitemap gets a coverage row.
    sitemap: [
      `${SITE_URL}/sitemap.xml`,
      `${SITE_URL}/data/sitemap.xml`,
      ...Array.from({ length: ADDRESS_SITEMAP_SHARDS }, (_, i) => `${SITE_URL}/addresses/sitemap/${i}.xml`),
    ],
    host: SITE_URL,
  };
}
