-- Migration 028: get_distinct_cohort_cities RPC
-- Purpose: return DISTINCT (city, city_region) pairs for the Hidden Equity cohort
--          picker WITHOUT scanning all 112k listings rows.
--
-- The function runs as STABLE and uses the lower(city)/lower(city_region) partial
-- indexes from backfill020.ts; only rows where both columns are non-null are
-- returned, mirroring the gate in buildCohortTree.
--
-- This is INSTANT DDL (editor-safe): no table writes, no index builds.
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
  'a full-table scan; relies on the lower(city)/lower(city_region) partial indexes '
  'from backfill020.ts to avoid exhausting the Supabase IO burst budget.';
