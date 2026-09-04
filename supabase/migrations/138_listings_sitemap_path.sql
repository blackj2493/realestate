-- 138: listings.sitemap_path — stop building the sitemap out of jsonb on a request path.
--
-- THIRD TIME. Migration 104 promoted transaction_type out of raw_payload because
-- "filtering 296k rows through a JSONB extraction is far more expensive than a column
-- read". Migration 137 did the same for the internet-display flags. This is the same
-- lesson a third time, and it has now broken production twice:
--
--   * The live /sitemap.xml carried 13,998 of 45,000 listing URLs for two days (#490).
--     Ten `full_payload->>` extractions paired with offset paging degrade with depth,
--     hit the 8s statement timeout around row 14,000, and the loop read the timeout as
--     "no more rows".
--   * The two-pass rewrite in #490 fixed correctness locally (45,000/45,000, worst chunk
--     2.3s) but NOT on Vercel. Its builder runs the sitemap alongside 57 other prerenders
--     all hitting Postgres at once, and under that contention the by-key chunks time out
--     too:
--         [sitemap] address chunk failed (1000 keys): canceling statement due to timeout
--         [sitemap] 17000 listing(s) fell back to the legacy path
--         Failed to build /sitemap.xml/route after 3 attempts (60s cap)
--     One build passed at 14:52 and the next failed at 14:58 on identical code, so main
--     itself was one unlucky deploy away from a red build.
--
-- No paging strategy fixes a per-row detoast. The column does.
--
-- WHAT IT HOLDS: the descriptive canonical path built by buildListingPath() —
-- /property/{prov}/{city}/{address}-{KEY} — the exact string the listing page emits as
-- its own `alternates.canonical`. Derived, and deliberately so: the sitemap needs one
-- cheap string per row, and the ingester rewrites it on every upsert, so any drift after
-- a change to buildListingPath self-heals on the next daily sync.
--
-- NULLABLE. A NULL is "not computed yet", and the reader falls back to /properties/{KEY}
-- — the same fallback the listing page uses, so the two can never disagree. It is a
-- resolvable URL rather than a wrong one, which is what matters for a sitemap entry.
--
-- No index. The sitemap reads this column, it never filters on it.
--
-- DDL only. The backfill is batched in scripts/admin/backfillListingsSitemapPath.ts
-- (it must run in TypeScript: buildListingPath does NFKD folding and dash-collapsing
-- that is not worth reimplementing in SQL, and a second implementation would be a second
-- thing to drift).

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS sitemap_path text;

COMMENT ON COLUMN public.listings.sitemap_path IS
  'Descriptive canonical path for this listing (/property/{prov}/{city}/{address}-{KEY}), '
  'precomputed by buildListingPath() so /sitemap.xml never extracts address fields from '
  'full_payload — see migrations 104 and 137 for the same lesson. Written on every upsert '
  'by scripts/worker/transformer.ts; backfilled by '
  'scripts/admin/backfillListingsSitemapPath.ts. NULL means not computed yet; readers '
  'fall back to /properties/{listing_key}.';
