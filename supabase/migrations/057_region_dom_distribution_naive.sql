-- Migration 057: region_dom_distribution += median_naive_dom (Hidden DoM gap).
--
-- Adds the naive per-current-listing median DOM (days since OriginalEntryTimestamp —
-- the MLS number that RESETS on every relist) alongside the relist-stitched median
-- true_dom. The panel contrasts them: "True 32d vs MLS 12d → 2.7x longer than the feed
-- shows". No backfill: OriginalEntryTimestamp is read from full_payload, which the
-- active CTE already detoasts for the status filter, so this is nearly free.
--
-- Adding a column to RETURNS TABLE changes the return type, so CREATE OR REPLACE is not
-- allowed — DROP + CREATE. The function is a Tier-1 addition (migration 056) read only by
-- the cached DoM panel, so the momentary gap is harmless (cached 24h; errors fall back).
--
-- Run: npx tsx scripts/admin/applyMigration057.ts

DROP FUNCTION IF EXISTS region_dom_distribution(text, text[], integer, numeric, integer, numeric, text);

CREATE FUNCTION region_dom_distribution(
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
SET statement_timeout = '60s'
AS $$
  WITH active AS (
    SELECT
      true_dom AS td,
      -- Naive current-listing age (resets on relist). Guard the cast: only parse values
      -- that look like an ISO timestamp; anything else -> NULL (excluded from the median).
      CASE
        WHEN full_payload->>'OriginalEntryTimestamp' ~ '^\d{4}-\d{2}-\d{2}'
        THEN GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - (full_payload->>'OriginalEntryTimestamp')::timestamptz)) / 86400))::int
        ELSE NULL
      END AS naive_dom
    FROM listings
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
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
      AND lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', ''))
          NOT IN ('sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended')
  )
  SELECT
    count(*)::int                                                              AS active_count,
    round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY td))::int               AS median_true_dom,
    round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY naive_dom))::int        AS median_naive_dom,
    round(percentile_cont(0.25) WITHIN GROUP (ORDER BY td))::int               AS p25_true_dom,
    round(percentile_cont(0.75) WITHIN GROUP (ORDER BY td))::int               AS p75_true_dom,
    count(*) FILTER (WHERE td BETWEEN 0  AND 14)::int                          AS dom_0_14,
    count(*) FILTER (WHERE td BETWEEN 15 AND 30)::int                          AS dom_15_30,
    count(*) FILTER (WHERE td BETWEEN 31 AND 60)::int                          AS dom_31_60,
    count(*) FILTER (WHERE td BETWEEN 61 AND 90)::int                          AS dom_61_90,
    count(*) FILTER (WHERE td >= 91)::int                                      AS dom_90_plus
  FROM active;
$$;

COMMENT ON FUNCTION region_dom_distribution(text, text[], integer, numeric, integer, numeric, text) IS
  'Full-population True-DoM distribution (median true + median naive/feed, p25/p75, 5 aging buckets) for one market area. Same active-set scoping as region_active_aggregates (migration 046). Scalars only, no listing rows (§6.3b). median_naive_dom = days since OriginalEntryTimestamp (resets on relist) for the Hidden-DoM-gap contrast.';
