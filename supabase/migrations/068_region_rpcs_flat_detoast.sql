-- Migration 068: region_active_aggregates + region_dom_distribution read FLAT columns
-- (standard_status, original_entry_timestamp) instead of detoasting full_payload per row.
--
-- Fixes the Toronto timeout (regression from 060): the status filter and the naive-DoM
-- floor now read migration-067 flat columns. Each uses COALESCE / ordered-CASE so a row
-- whose flat column is still NULL falls back to full_payload (null-safe during/after the
-- backfill) — but once backfilled, the flat branch short-circuits and NO detoast happens.
-- Bodies are migration 060 verbatim with ONLY the status-filter + naive-age expressions
-- swapped. APPLY AFTER backfillFlatStatusEntry.ts completes. statement_timeout kept at 90s
-- for headroom on any residual null-fallback rows.
--
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 068_region_rpcs_flat_detoast.sql

-- ── region_dom_distribution ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION region_dom_distribution(
  p_region      text,
  p_subtypes    text[]  DEFAULT NULL,
  p_min_beds    integer DEFAULT 0,
  p_min_baths   numeric DEFAULT 0,
  p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0,
  p_basement    text    DEFAULT 'any'
)
RETURNS TABLE (
  active_count    integer,
  median_true_dom integer,
  median_naive_dom integer,
  p25_true_dom    integer,
  p75_true_dom    integer,
  dom_0_14        integer,
  dom_15_30       integer,
  dom_31_60       integer,
  dom_61_90       integer,
  dom_90_plus     integer
)
LANGUAGE sql
STABLE
SET statement_timeout = '90s'
AS $$
  WITH active AS (
    SELECT
      GREATEST(
        true_dom,
        CASE
          WHEN original_entry_timestamp IS NOT NULL
            THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - original_entry_timestamp)) / 86400))::int
          WHEN full_payload->>'OriginalEntryTimestamp' ~ '^\d{4}-\d{2}-\d{2}'
            THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - (full_payload->>'OriginalEntryTimestamp')::timestamptz)) / 86400))::int
          ELSE 0 END
      ) AS td,
      CASE
        WHEN original_entry_timestamp IS NOT NULL
          THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - original_entry_timestamp)) / 86400))::int
        WHEN full_payload->>'OriginalEntryTimestamp' ~ '^\d{4}-\d{2}-\d{2}'
          THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - (full_payload->>'OriginalEntryTimestamp')::timestamptz)) / 86400))::int
        ELSE NULL END AS naive
    FROM listings
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
        OR lower(full_payload->>'CountyOrParish') = lower(p_region)
      )
      AND list_price >= 50000
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      AND (p_min_beds     <= 0 OR COALESCE(bedrooms_total,          NULLIF(full_payload->>'BedroomsTotal', '')::numeric)         >= p_min_beds)
      AND (p_min_baths    <= 0 OR COALESCE(bathrooms_total_integer, NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric) >= p_min_baths)
      AND (p_min_parking  <= 0 OR COALESCE(parking_total,           NULLIF(full_payload->>'ParkingTotal', '')::numeric)          >= p_min_parking)
      AND (p_min_frontage <= 0 OR COALESCE(lot_width,               NULLIF(full_payload->>'LotWidth', '')::numeric)              >= p_min_frontage)
      AND (
        p_basement = 'any'
        OR (basement_tier IS NOT NULL AND (
              (p_basement = 'finished'   AND basement_tier BETWEEN 1 AND 5)
           OR (p_basement = 'unfinished' AND basement_tier BETWEEN 6 AND 8)))
        OR (basement_tier IS NULL AND (
              (p_basement = 'finished'
                 AND full_payload->'Basement' ?| array['Finished', 'Apartment', 'Finished with Walk-Out', 'Partially Finished'])
           OR (p_basement = 'unfinished'
                 AND full_payload->'Basement' ? 'Unfinished')))
      )
      AND COALESCE(standard_status,
            lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', '')))
          NOT IN ('sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended')
  )
  SELECT
    count(*)::int                                                              AS active_count,
    round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY td))::int               AS median_true_dom,
    round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY naive))::int            AS median_naive_dom,
    round(percentile_cont(0.25) WITHIN GROUP (ORDER BY td))::int               AS p25_true_dom,
    round(percentile_cont(0.75) WITHIN GROUP (ORDER BY td))::int               AS p75_true_dom,
    count(*) FILTER (WHERE td BETWEEN 0  AND 14)::int                          AS dom_0_14,
    count(*) FILTER (WHERE td BETWEEN 15 AND 30)::int                          AS dom_15_30,
    count(*) FILTER (WHERE td BETWEEN 31 AND 60)::int                          AS dom_31_60,
    count(*) FILTER (WHERE td BETWEEN 61 AND 90)::int                          AS dom_61_90,
    count(*) FILTER (WHERE td >= 91)::int                                      AS dom_90_plus
  FROM active;
$$;

-- ── region_active_aggregates ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION region_active_aggregates(
  p_region      text,
  p_subtypes    text[]  DEFAULT NULL,
  p_min_beds    integer DEFAULT 0,
  p_min_baths   numeric DEFAULT 0,
  p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0,
  p_basement    text    DEFAULT 'any'
)
RETURNS TABLE (
  active_count    integer,
  cap_sample      integer,
  median_cap_rate numeric,
  avg_cap_rate    numeric,
  top_cap_rate    numeric,
  stale_count     integer
)
LANGUAGE sql
STABLE
SET statement_timeout = '90s'
AS $$
  WITH active AS (
    SELECT
      cap_rate_est AS cap,
      GREATEST(
        true_dom,
        CASE
          WHEN original_entry_timestamp IS NOT NULL
            THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - original_entry_timestamp)) / 86400))::int
          WHEN full_payload->>'OriginalEntryTimestamp' ~ '^\d{4}-\d{2}-\d{2}'
            THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - (full_payload->>'OriginalEntryTimestamp')::timestamptz)) / 86400))::int
          ELSE 0 END
      ) AS eff_dom
    FROM listings
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
        OR lower(full_payload->>'CountyOrParish') = lower(p_region)
      )
      AND list_price >= 50000
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      AND (p_min_beds     <= 0 OR COALESCE(bedrooms_total,          NULLIF(full_payload->>'BedroomsTotal', '')::numeric)         >= p_min_beds)
      AND (p_min_baths    <= 0 OR COALESCE(bathrooms_total_integer, NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric) >= p_min_baths)
      AND (p_min_parking  <= 0 OR COALESCE(parking_total,           NULLIF(full_payload->>'ParkingTotal', '')::numeric)          >= p_min_parking)
      AND (p_min_frontage <= 0 OR COALESCE(lot_width,               NULLIF(full_payload->>'LotWidth', '')::numeric)              >= p_min_frontage)
      AND (
        p_basement = 'any'
        OR (basement_tier IS NOT NULL AND (
              (p_basement = 'finished'   AND basement_tier BETWEEN 1 AND 5)
           OR (p_basement = 'unfinished' AND basement_tier BETWEEN 6 AND 8)))
        OR (basement_tier IS NULL AND (
              (p_basement = 'finished'
                 AND full_payload->'Basement' ?| array['Finished', 'Apartment', 'Finished with Walk-Out', 'Partially Finished'])
           OR (p_basement = 'unfinished'
                 AND full_payload->'Basement' ? 'Unfinished')))
      )
      AND COALESCE(standard_status,
            lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', '')))
          NOT IN ('sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended')
  )
  SELECT
    count(*)::int AS active_count,
    count(*) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::int AS cap_sample,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY cap)
          FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::numeric, 2) AS median_cap_rate,
    round(avg(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2) AS avg_cap_rate,
    round(max(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2) AS top_cap_rate,
    count(*) FILTER (WHERE eff_dom > 60)::int AS stale_count
  FROM active;
$$;

COMMENT ON FUNCTION region_active_aggregates(text, text[], integer, numeric, integer, numeric, text) IS
  'Full-population active-inventory aggregates. Reads flat standard_status + original_entry_timestamp (migration 068) to skip the per-row full_payload detoast that timed Toronto out; COALESCE falls back to full_payload for un-backfilled rows. stale_count = naive-floored DOM > 60.';
COMMENT ON FUNCTION region_dom_distribution(text, text[], integer, numeric, integer, numeric, text) IS
  'True-DoM distribution, naive-floored via flat original_entry_timestamp (migration 068, COALESCE→full_payload fallback) so campaign-refresh misses read correctly without a detoast. Same active-set scoping as region_active_aggregates.';
