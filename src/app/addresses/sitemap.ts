import type { MetadataRoute } from "next";
import { getSoldSitemapShard } from "@/lib/sold/soldByKey";
import { buildAddressPath } from "@/lib/listings/listingPath";
import { ADDRESS_SITEMAP_SHARDS, SHARD_URLS, addressSitemapWindowStart } from "@/lib/sold/addressSitemapShards";

/**
 * /addresses/sitemap/{n}.xml — the public /address (sold) pages, sharded.
 *
 * Uses Next's built-in sitemap mechanism (same as app/sitemap.ts) rather than a custom
 * route handler: Next serves these as properly-cached, non-chunked XML files that
 * Google's sitemap fetcher reliably reads. generateSitemaps() splits them because the
 * protocol caps ONE file at 50,000 URLs and the source holds far more than that.
 *
 * SOURCE CHANGED 2026-09-02. This read `sold_listings` (Typesense) and took the first
 * 45,000 lines of an unordered, unfiltered `.export()` — an arbitrary 23% slice of
 * 199,253 documents that mixed sold, leased and de-listed records, bounded to the
 * collection's rolling 180-day prune. It now reads raw_vow_sold, which is permanent and
 * holds 268,510 sales, filtered to actual sales and to the window below.
 *
 * Every row is gated on the seller's internet-display opt-out in the query itself —
 * see getSoldSitemapShard. A sitemap entry publishes an address; both board switches
 * forbid exactly that.
 */
/**
 * NOT prerendered at build. Next builds every shard during `next build`, where they queue
 * behind 57 other prerenders all hitting the same database — and under that contention
 * these queries time out. That is how seven EMPTY shards reached production while the
 * build reported success (2026-09-05).
 *
 * The same contention already broke /sitemap.xml twice; there it was fixed by removing
 * the work (migration 138). Here the work is irreducible — 121,635 rows have to be read —
 * so it moves OFF the build instead. Rendered on request, cached for a day by the CDN
 * headers below, and generated in isolation where nothing else is competing for Postgres.
 */
export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

export async function generateSitemaps(): Promise<{ id: number }[]> {
  // A FIXED shard count, not one derived from a live COUNT. robots.txt has to name
  // these files, and a count that moves between the two renders leaves either a
  // declared-but-missing shard or an unannounced one. A shard past the end of the data
  // renders as a valid empty sitemap, which costs nothing.
  return Array.from({ length: ADDRESS_SITEMAP_SHARDS }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  // Next types this `number` and hands it the RAW URL SEGMENT: "0.xml", not 0. Multiplying
  // that by SHARD_URLS gives NaN, .range(NaN, NaN) fails, and every one of the seven
  // shards shipped EMPTY to production on 2026-09-05 while the build reported success.
  // parseInt stops at the dot, so it reads both "0.xml" and a real 0.
  const shard = Number.parseInt(String(id), 10);
  if (!Number.isFinite(shard) || shard < 0 || shard >= ADDRESS_SITEMAP_SHARDS) {
    console.error(`[sitemap] address shard id ${JSON.stringify(id)} is not a shard index — serving empty`);
    return [];
  }

  const entries = await getSoldSitemapShard(shard * SHARD_URLS, SHARD_URLS, addressSitemapWindowStart());
  const out: MetadataRoute.Sitemap = [];
  for (const e of entries) {
    // Same builder the in-page links use — a sitemap URL the links can't reproduce is
    // what made this sitemap the address tree's only crawl path (see buildAddressPath).
    const path = buildAddressPath(e);
    if (!path) continue;
    out.push({ url: `${SITE_URL}${path}`, changeFrequency: "monthly", priority: 0.5 });
  }
  return out;
}
