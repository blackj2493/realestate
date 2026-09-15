/**
 * Shape of the sharded listing sitemap — shared by the route that RENDERS the shards and
 * by robots.ts, which has to name every one of them.
 *
 * These two must never disagree. A shard robots.txt names but the route doesn't render is
 * a 404 in Search Console; one the route renders but robots.txt omits is invisible. Hence
 * one module, two importers — the same arrangement as addressSitemapShards.ts, for the
 * same reason.
 */

/** URLs per shard. The sitemap protocol caps a single file at 50,000. */
export const LISTING_SHARD_URLS = 20_000;

/**
 * Fixed shard count → 60,000 URLs of capacity against 18,773 live listings (2026-09-15).
 *
 * WHY THESE MOVED OUT OF /sitemap.xml. That file had reached 47,646 of the protocol's
 * 50,000-URL cap. At the cap Google rejects the ENTIRE file — not the overflow — so every
 * URL in it stops being discovered at once, while the build stays green and nothing in the
 * app reports a thing. Listings are the part that grows with market activity, so they are
 * the part that had to leave.
 *
 * A FIXED count, not one derived from a live COUNT: robots.txt has to name these files,
 * and a count that moves between the two renders leaves either a declared-but-missing
 * shard or an unannounced one. A shard past the end of the data renders as a valid empty
 * sitemap, which costs nothing.
 */
export const LISTING_SITEMAP_SHARDS = 3;

/** Total listing URLs the sitemap can declare. Raising it means raising the shard count. */
export const LISTING_SITEMAP_CAPACITY = LISTING_SHARD_URLS * LISTING_SITEMAP_SHARDS;
