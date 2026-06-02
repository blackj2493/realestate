-- Migration 028: get_distinct_cohort_cities RPC + supporting composite index
-- Purpose: return DISTINCT (city, city_region) pairs for the Hidden Equity cohort
--          picker WITHOUT scanning all 112k listings rows.
--
-- The function runs as STABLE. Only rows where both columns are non-null are
-- returned, mirroring the gate in buildCohortTree.
--
-- Performance: the DISTINCT is served from idx_listings_city_cityregion (defined
-- below), a plain composite index on (city, city_region). This enables an
-- index-only scan of the ~few-thousand distinct pairs instead of a 112k-row seq
-- scan. Note: the lower(city)/lower(city_region) partial expression-indexes from
-- backfill020.ts are NOT used by this DISTINCT query (they are expression indexes
-- on lower-cased values; this query operates on plain columns only).
--
-- The index build touches plain columns only (no full_payload JSONB detoast), so
-- it is safe to run without batching and will complete quickly.
--
-- Run: paste into the Supabase SQL editor, or:
--      npx tsx scripts/admin/applyMigration028.ts

CREATE OR REPLACE FUNCTION get_distinct_cohort_cities()
RETURNS TABLE(city text, city_region text)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT city, city_region
  FROM   listings
  WHERE  city_region IS NOT NULL
    AND  city        IS NOT NULL
$$;

COMMENT ON FUNCTION get_distinct_cohort_cities() IS
  'Returns distinct (city, city_region) pairs for the Hidden Equity cohort picker. '
  'Used by /api/avm/cohorts to map city_region audit rows to parent cities without '
  'a full-table scan; relies on idx_listings_city_cityregion (migration 028) to '
  'serve the DISTINCT as an index-only scan and avoid exhausting the Supabase IO '
  'burst budget.';

-- Serve the DISTINCT (city, city_region) from an index-only scan instead of a
-- 112k-row seq scan. Predicate is on plain columns only (no JSONB detoast) so
-- this build is fast and editor-safe.
CREATE INDEX IF NOT EXISTS idx_listings_city_cityregion
  ON listings (city, city_region)
  WHERE city IS NOT NULL AND city_region IS NOT NULL;
