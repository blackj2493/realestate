import type { MetadataRoute } from "next";
import { getServiceRoleClient } from "@/lib/supabase/client";
import {
  LISTING_SHARD_URLS,
  LISTING_SITEMAP_SHARDS,
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

// NOTE: `listings` is NOT active-only — Query B upserts Closed (sold) payloads here, and
// Terminated/Expired/Suspended rows stay frozen-Active — so this sitemap DOES emit their
// URLs. That is safe: the listing page resolves the TRUE status and sets robots:noindex
// for every non-active listing (see properties/[id] generateMetadata), so sold and
// off-market pages are discoverable but never indexed, and all VOW numbers (close price,
// sold DOM) are gated at render. To stop emitting them entirely, filter here by resolved
// status (anti-join raw_vow_delisted for the frozen-Active terminated rows).
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

/** One shard's worth of rows, read in PostgREST-sized pages from the shard's offset. */
async function shardRows(
  supabase: ReturnType<typeof getServiceRoleClient>,
  shard: number
): Promise<ListingSitemapRow[]> {
  const base = shard * LISTING_SHARD_URLS;
  const rows: ListingSitemapRow[] = [];
  for (let taken = 0; taken < LISTING_SHARD_URLS; taken += PAGE) {
    const from = base + taken;
    const to = Math.min(from + PAGE, base + LISTING_SHARD_URLS) - 1;
    const { data, error } = await supabase
      .from("listings")
      .select(LISTING_SELECT)
      .order("listing_key")
      .range(from, to);
    if (error) {
      // Loudly, and stop — but never silently, and never as if the table simply ended.
      // Conflating those is what hid a 69% shortfall in the root sitemap for two days.
      console.error(`[sitemap] listing shard ${shard} failed at offset ${from}: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as ListingSitemapRow[]));
    if (data.length < to - from + 1) break;
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
