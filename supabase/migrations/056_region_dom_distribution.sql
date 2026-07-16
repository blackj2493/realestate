-- Migration 056: region_dom_distribution — True-DoM distribution for a market area.
--
-- Powers the Tier-1 "True Days on Market" panel (median + p25/p75 + aging buckets).
-- ADDITIVE: a NEW function, so region_active_aggregates (the live scorecard) is
-- untouched — no DROP, no return-type change, zero risk to the working dashboard.
--
-- The `active` CTE is migration 046's VERBATIM scoping (region roll-up, list_price
-- floor, subtype/beds/baths/parking/frontage/basement floors, non-active status
-- exclusion) so this function's active set is IDENTICAL to region_active_aggregates —
-- the DoM panel and the scorecard count the same listings. The only change is it
-- selects the flat `true_dom` column (migration 005; populated by sync.ts +
-- the 2026-07 backfill) instead of cap_rate_est/is_stale.
--
-- true_dom = 0 (brand-new listings, and any campaign-refresh miss) is INCLUDED — we
-- report the honest distribution and never fabricate a value; the 0–14 bucket carries
-- them and the percentiles interpolate over the real data.
--
-- Run: npx tsx scripts/admin/applyMigration056.ts   (or paste into the SQL editor)

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
    SELECT true_dom AS td
    FROM listings
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        -- Toronto district-code roll-up (migration 042). Index-usable range + strict recheck.
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
      )
      AND list_price >= 50000
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      -- Floors read flat columns (migration 045) with a full_payload fallback for un-backfilled rows.
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
  'Full-population True-DoM distribution (median, p25/p75, 5 aging buckets) for one market area. Same active-set scoping as region_active_aggregates (migration 046); reads the flat true_dom column. Scalars only, no listing rows (§6.3b). Stale line = 60d (buckets 61-90 + 90+).';
