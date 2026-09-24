import type { MetadataRoute } from "next";
import { getServiceRoleClient } from "@/lib/supabase/client";
import {
  LISTING_SHARD_URLS,
  LISTING_SITEMAP_SHARDS,
  LISTING_ACTIVE_STATUSES,
} from "@/lib/listings/listingSitemapShards";

/**
 * /listings/sitemap/{n}.xml — every active listing URL, sharded.
 *
 * WHY IT LEFT /sitemap.xml. That file had reached 47,646 of the protocol's 50,000-URL
 * cap. At the cap Google rejects the ENTIRE file, so every URL in it — hubs, trackers,
 * listings alike — stops being discovered at once, while the build stays green and
 * nothing reports a thing. Listings are the part that grows with market activity, so
 * they are the part that moved. The root file keeps the static and hub routes and drops
 * to roughly 28,900 with real headroom.
 *
 * WHY /listings AND NOT /properties. The pages live at /properties/{key}, but a sitemap
 * route there would render at /properties/sitemap/0.xml and collide with the
 * /properties/[id] dynamic segment, which matches "sitemap" perfectly well. The address
 * tree already solved this the same way: pages at /address/..., sitemap at
 * /addresses/sitemap/{n}.xml. This is that convention, not a new one.
 *
 * ORDERED BY listing_key, NOT synced_at. Shard N is rows [N×20000, (N+1)×20000) of one
 * ordering, and the three shards do not render at the same instant. Ordering by a column
 * the nightly ETL rewrites would reshuffle the boundaries between renders, so a listing
 * could appear in two shards or in none. listing_key never moves.
 */

// ON-MARKET ROWS ONLY. `listings` is not active-only — Query B upserts Closed payloads
// into the same table — so this query filters rather than taking whatever the offset
// lands on. The old root sitemap emitted sold rows deliberately, on the reasoning that
// the listing page noindexes them anyway so they are "discoverable but never indexed".
// That reasoning holds in isolation and fails on a crawl budget: 130,917 of 327,723 rows
// are sold or leased (2026-09-15), and declaring them asks Google to fetch ~40% of this
// sitemap only to be told to discard it — on a site where /data went two months without
// being crawled at all. See LISTING_ACTIVE_STATUSES.
//
// Rendered on request rather than at build. Same reasoning as the address shards: the
// Vercel builder runs dozens of prerenders against the same Postgres, and a paginated
// read under that contention is how /sitemap.xml shipped 13,998 of 45,000 for two days.
export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const PAGE = 1000; // PostgREST hard-caps a single response at 1000 rows — must paginate

interface ListingSitemapRow {
  listing_key: string | null;
  synced_at: string | null;
  sitemap_path: string | null;
}

const LISTING_SELECT = "listing_key, synced_at, sitemap_path";

export async function generateSitemaps(): Promise<{ id: number }[]> {
  // A FIXED shard count, not one derived from a live COUNT — robots.txt has to name these
  // files, and a count that moves between the two renders leaves either a
  // declared-but-missing shard or an unannounced one.
  return Array.from({ length: LISTING_SITEMAP_SHARDS }, (_, id) => ({ id }));
}

/**
 * The shard index, out of whatever Next actually hands this route.
 *
 * Next TYPES this param `number`. Production said otherwise, twice, on the address
 * shards: `JSON.stringify(id)` logged `{}` because it is a PROMISE (Next 16 made these
 * async), and awaited it is the raw URL segment "0.xml", not 0. Either one made the
 * offset NaN and shipped every shard EMPTY while the build reported success.
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
  if (!Number.isFinite(shard) || shard < 0 || shard >= LISTING_SITEMAP_SHARDS) {
    // Name the SHAPE, not just the value — `{}` was all the address version printed, and
    // working that out cost a deploy.
    console.error(
      `[sitemap] listing shard id is not a shard index — serving empty. ` +
        `typeof=${typeof resolved} ctor=${(resolved as object)?.constructor?.name ?? "-"} ` +
        `raw=${JSON.stringify(raw) ?? String(raw)} parsed=${shard}`
    );
    return null;
  }
  return shard;
}

/**
 * One shard's worth of rows: SEEK to the shard's first key, then walk forward by KEYSET.
 *
 * WHY NOT OFFSET. This paged with `.range(base + taken, …)` until 2026-09-24 and the
 * shards served 12,000 of 104,889 URLs, two of them empty. Migration 148's partial index
 * was necessary but NOT sufficient — measured on production, with the index in place and
 * being used:
 *
 *     OFFSET 40000 : Index Scan, rows=41000, buffers hit=27909 read=12222 → 4,568 ms
 *     KEYSET       : Index Scan, rows=1000,  buffers hit=988             →     1.8 ms
 *
 * OFFSET has to walk AND HEAP-VISIT every row it discards, because synced_at and
 * sitemap_path are not in the index. At offsets of 20,000+ that crossed the 8s statement
 * timeout, so shard 0 died mid-slice and shards 1 and 2 died on their first page.
 *
 * The seek is the one exception, and it is cheap precisely because it asks for NOTHING
 * but listing_key — the index column — so it runs as an Index Only Scan: 30-41 ms at
 * offset 20,000 through 140,000. One of those per shard, then every page after it reads
 * only the rows it returns.
 *
 * An error is never treated as exhaustion. Both look like an empty <urlset> to a crawler
 * and leave the build green, which is how this shipped silently twice.
 */
async function shardRows(
  supabase: ReturnType<typeof getServiceRoleClient>,
  shard: number
): Promise<ListingSitemapRow[]> {
  const base = shard * LISTING_SHARD_URLS;
  const rows: ListingSitemapRow[] = [];

  /** The shard's population, filtered identically at every step — see migration 148:
   *  widen these and the index predicate stops matching, silently. */
  const scoped = <T>(q: T): T =>
    (q as unknown as { in: (c: string, v: string[]) => { eq: (c: string, v: boolean) => T } })
      .in("standard_status", LISTING_ACTIVE_STATUSES as unknown as string[])
      .eq("is_orphaned", false);

  // 1. Where does this shard start? Shard 0 starts at the beginning and needs no seek.
  let cursor: string | null = null;
  if (base > 0) {
    const { data, error } = await scoped(supabase.from("listings").select("listing_key"))
      .order("listing_key")
      .range(base, base);
    if (error) {
      console.error(`[sitemap] listing shard ${shard} seek to ${base} failed: ${error.message}`);
      return [];
    }
    // No row at that offset = this shard is past the end of the data. A valid empty
    // sitemap, and NOT the same thing as a failure — which is why the error above
    // returns separately rather than falling through to here.
    if (!data || data.length === 0) return [];
    cursor = (data[0] as unknown as { listing_key: string }).listing_key;
  }

  // 2. Walk forward. The first page must INCLUDE the boundary key the seek returned.
  let inclusive = true;
  while (rows.length < LISTING_SHARD_URLS) {
    const want = Math.min(PAGE, LISTING_SHARD_URLS - rows.length);
    let q = scoped(supabase.from("listings").select(LISTING_SELECT)).order("listing_key").limit(want);
    if (cursor !== null) {
      q = inclusive
        ? (q as unknown as { gte: (c: string, v: string) => typeof q }).gte("listing_key", cursor)
        : (q as unknown as { gt: (c: string, v: string) => typeof q }).gt("listing_key", cursor);
    }
    const { data, error } = await q;
    if (error) {
      console.error(`[sitemap] listing shard ${shard} failed after ${rows.length} rows: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    const page = data as unknown as ListingSitemapRow[];
    rows.push(...page);
    cursor = page[page.length - 1].listing_key;
    inclusive = false;
    if (page.length < want) break; // exhausted
  }
  return rows;
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const shard = await shardIndex(id);
  if (shard === null) return [];

  const rows = await shardRows(getServiceRoleClient(), shard);
  const unresolved = rows.filter((r) => !r.sitemap_path).length;
  if (unresolved > 0) {
    // Not fatal — those rows still ship under /properties/{KEY} — but it means the
    // backfill has not reached them or the ingester stopped writing the column.
    console.warn(`[sitemap] shard ${shard}: ${unresolved} listing(s) have no sitemap_path`);
  }

  return rows
    .filter((row) => row.listing_key)
    .map((row) => ({
      // The precomputed canonical, or the legacy path when it was never computed — the
      // same fallback properties/[id] uses, so the two can never disagree.
      url: `${SITE_URL}${row.sitemap_path || `/properties/${row.listing_key}`}`,
      lastModified: row.synced_at ? new Date(row.synced_at) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));
}
