-- 140: get_distinct_cohort_cities — stop sequential-scanning 311k listings to find 2,212 names.
--
-- THE BUG. /whats-my-home-hiding awaits loadCohortTreeSafe(), which calls this function to
-- build the neighbourhood picker. The old body was:
--
--     SELECT DISTINCT city, city_region FROM listings
--      WHERE city_region IS NOT NULL AND city IS NOT NULL
--
-- `listings` is 311,537 rows / 4 GB, and the planner answered that with a Seq Scan over all
-- 53,502 heap blocks to produce 2,212 distinct pairs:
--
--     HashAggregate (actual time=4290.243..4291.019 rows=2212)
--       ->  Seq Scan on listings (actual time=0.660..4116.160 rows=301089)
--     Execution Time: 4291.985 ms          -- WARM. Cold is far worse: read=32114 blocks.
--
-- PostgREST runs as `authenticator`, which carries statement_timeout = 8s. Cold, the scan
-- blew through it and threw 57014; loadCohortTree's withRetry then paid a SECOND 8s before
-- giving up. Measured on prod 2026-09-06: three cold hits of the page took 16.8s, 16.7s and
-- 19.2s (≈ 2 × 8s), and two of the three then served an EMPTY picker tree, because
-- loadCohortTreeSafe degrades rather than 500s. Warm hits: 0.16s.
--
-- THE FIX. A loose index scan (a.k.a. skip scan): walk `idx_listings_city_cityregion` one
-- distinct pair at a time instead of reading every row and de-duplicating afterwards. The
-- work becomes 2,212 index seeks rather than 311k heap tuples.
--
--     CTE Scan on t (actual time=0.065..41.778 rows=2212)
--       ->  Recursive Union ... Index Only Scan using idx_listings_city_cityregion
--     Execution Time: 42.044 ms            -- 102x faster
--
-- Verified read-only against prod before writing this migration: the two bodies return the
-- SAME 2,212 pairs — onlyOld = 0, onlyNew = 0. Timings over three runs: 1371ms cold (index
-- pages not yet in cache), then 73ms and 49ms. Even the cold case now clears 8s by 6x.
--
-- The CTE columns are named (c, cr) on purpose: RETURNS TABLE declares output columns named
-- `city` and `city_region`, and reusing those names inside the body invites a resolution
-- ambiguity. Every reference below is alias-qualified.
--
-- Output ORDER is not part of the contract and does not need to be: PostgREST applies its
-- own ORDER BY / LIMIT around the call (loadCohortTree pages with .order('city')
-- .order('city_region').range(...)), so pagination stays deterministic exactly as before.
--
-- Rollback: restore the SELECT DISTINCT body above.

-- This function's plan depends ENTIRELY on a btree leading with (city, city_region). Without
-- one, each of the 2,212 recursive steps degrades to its own scan and the function becomes
-- far slower than the version it replaced. Fail the migration rather than ship that quietly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'listings'
       AND indexdef ILIKE '%btree (city, city_region)%'
  ) THEN
    RAISE EXCEPTION
      'get_distinct_cohort_cities needs a btree on listings (city, city_region) — expected idx_listings_city_cityregion. Create it before applying 140.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_distinct_cohort_cities()
RETURNS TABLE(city text, city_region text)
LANGUAGE sql
STABLE
AS $function$
  WITH RECURSIVE t(c, cr) AS (
    (SELECT l.city, l.city_region
       FROM listings l
      WHERE l.city IS NOT NULL AND l.city_region IS NOT NULL
      ORDER BY l.city, l.city_region
      LIMIT 1)
    UNION ALL
    SELECT n.city, n.city_region
      FROM t
      CROSS JOIN LATERAL (
        SELECT l.city, l.city_region
          FROM listings l
         WHERE l.city IS NOT NULL AND l.city_region IS NOT NULL
           AND (l.city, l.city_region) > (t.c, t.cr)
         ORDER BY l.city, l.city_region
         LIMIT 1
      ) n
  )
  SELECT t.c, t.cr FROM t
$function$;

COMMENT ON FUNCTION public.get_distinct_cohort_cities() IS
  'Distinct (city, city_region) pairs for the AVM cohort tree. Loose index scan over idx_listings_city_cityregion (migration 140) — ~42ms. Do NOT rewrite as SELECT DISTINCT: that seq-scans 311k rows, takes >4s warm, and times out under the 8s PostgREST statement_timeout.';
