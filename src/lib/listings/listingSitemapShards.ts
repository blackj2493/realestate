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
 * Fixed shard count → 160,000 URLs of capacity against 104,889 eligible listings
 * (measured 2026-09-24: standard_status IN LISTING_ACTIVE_STATUSES AND is_orphaned=false).
 *
 * THE 18,773 THIS WAS SIZED FOR WAS WRONG. That figure came from counting `/properties`
 * URLs in the old root sitemap, which was itself capped at MAX_URLS = 45,000 and, after
 * #491, emitted listings under their DESCRIPTIVE canonical (/property/on/{city}/…-{KEY}) —
 * so the count that looked like "listings" was a prefix match that had already been
 * truncated. The real on-market population is 5.6x that. At 3 shards, 44,889 listings had
 * no file to live in even once the query was fixed — silently, because a shard past the
 * end of the data is indistinguishable from a shard the query failed on.
 *
 * Sized with headroom on purpose: active inventory swings seasonally, and running out is
 * invisible. Re-measure before trimming it.
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
export const LISTING_SITEMAP_SHARDS = 8;

/** Total listing URLs the sitemap can declare. Raising it means raising the shard count. */
export const LISTING_SITEMAP_CAPACITY = LISTING_SHARD_URLS * LISTING_SITEMAP_SHARDS;

/**
 * TRREB `standard_status` values that mean the listing is still on the market.
 *
 * WHY THE SITEMAP FILTERS ON THIS. `listings` is not active-only: Query B upserts Closed
 * payloads into the same table, so of 327,723 rows (2026-09-15) only 196,424 carry an
 * on-market status and 130,917 are sold or leased. The listing page sets robots:noindex
 * for every non-active listing, so declaring those URLs asks Google to spend crawl budget
 * fetching pages it is then told to discard — on a site where /data went two months
 * without being crawled at all, that budget is the scarce thing.
 *
 * Values are lowercase as the feed writes them. Anything not listed here — "sold",
 * "leased", "sold conditional", "sold conditional escape" — is excluded.
 */
export const LISTING_ACTIVE_STATUSES = ["new", "price change", "extension"] as const;
