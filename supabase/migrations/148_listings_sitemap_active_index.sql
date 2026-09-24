-- 148: partial index for /listings/sitemap/{n}.xml — the shard query times out without it.
--
-- WHAT IS BROKEN RIGHT NOW. The listing sitemap (#541) filters on `standard_status` and
-- `is_orphaned`, neither of which is indexed, then pages with OFFSET ordered by
-- listing_key. Postgres therefore walks the primary-key index from the start on EVERY
-- page, applying an unindexed filter to each row and discarding `offset` matches before
-- returning any. Cost grows with depth. Measured against production 2026-09-24, one
-- 1,000-row page of the exact query the route runs:
--
--     offset      0    1,789 ms
--     offset 11,000    7,167 ms
--     offset 12,000    7,025 ms
--     offset 20,000    8,059 ms   <- canceling statement due to statement timeout
--
-- So shard 0 died partway through its own slice and shards 1 and 2, which begin at
-- offsets 20,000 and 40,000, died on their FIRST page. Live result: 12,000 URLs declared
-- of 104,889 eligible, across three files two of which served an empty <urlset>.
--
-- This is the third shape of the same lesson (104 / 137 / 138): the sitemap must not do
-- work per row that the table has not been prepared for. There the answer was a column;
-- here the filter columns already exist and only the access path is missing.
--
-- THE PREDICATE MATCHES THE QUERY EXACTLY. `.in('standard_status', LISTING_ACTIVE_STATUSES)`
-- and `.eq('is_orphaned', false)` — keep the two in step: widen LISTING_ACTIVE_STATUSES
-- without widening this index and the planner silently stops using it, which looks exactly
-- like the outage above. `is_orphaned = false` (not COALESCE) because zero active-status
-- rows carry NULL (verified 2026-09-24), and the query excludes them identically.
--
-- INDEXED ON listing_key ALONE. That is the ORDER BY, so with the predicate satisfied the
-- scan walks this index in output order and an OFFSET just skips entries — cheap at any
-- depth, no sort, no heap visit to filter.
--
-- CONCURRENTLY, and therefore the ONLY statement in this file: `listings` takes writes
-- from the daily sync, and applyMigrationFiles.ts sends a file as one simple query, which
-- Postgres runs as one implicit transaction when it holds more than one statement —
-- CREATE INDEX CONCURRENTLY is rejected inside a transaction block. Everything else here
-- is a comment on purpose. Expect a few minutes; it does not block writes.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_sitemap_active
  ON public.listings (listing_key)
  WHERE standard_status IN ('new', 'price change', 'extension')
    AND is_orphaned = false;
