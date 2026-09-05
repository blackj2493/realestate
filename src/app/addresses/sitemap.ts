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

/**
 * The shard index, out of whatever Next actually hands this route.
 *
 * Next TYPES this param `number`. Production said otherwise, twice:
 *   - `JSON.stringify(id)` logged `{}` — it is a PROMISE (Next 16 made these async), and
 *     `String(promise)` is "[object Promise]", which parses to NaN.
 *   - Awaited, the value is the raw URL segment "0.xml", not 0.
 * Either one made the offset NaN, `.range(NaN, NaN)` fail, and all seven shards ship
 * EMPTY while the build reported success — three deploys running.
 *
 * So: await it, then parse leniently. parseInt stops at the dot, so "0.xml", "0" and 0
 * all read alike, and an object shape degrades to NaN and is rejected rather than
 * silently querying offset 0.
 */
async function shardIndex(id: unknown): Promise<number | null> {
  const resolved = await id;
  const raw =
    resolved !== null && typeof resolved === "object"
      ? ((resolved as Record<string, unknown>).id ?? Object.values(resolved as object)[0])
      : resolved;
  const shard = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(shard) || shard < 0 || shard >= ADDRESS_SITEMAP_SHARDS) {
    // Name the SHAPE, not just the value — `{}` was all the first version printed, and
    // that cost a deploy to work out.
    console.error(
      `[sitemap] address shard id is not a shard index — serving empty. ` +
        `typeof=${typeof resolved} ctor=${(resolved as object)?.constructor?.name ?? "-"} ` +
        `raw=${JSON.stringify(raw) ?? String(raw)} parsed=${shard}`
    );
    return null;
  }
  return shard;
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const shard = await shardIndex(id);
  if (shard === null) return [];

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
