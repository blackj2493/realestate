-- Migration 058: region_price_cuts — price-cut pressure for a market area (Tier-1 B).
--
-- ADDITIVE new function (region_active_aggregates untouched). Share of active listings
-- that have cut their price + median $ and % depth, from the relist-stitched
-- total_price_drop (written to full_payload by sync.ts; the active CTE already detoasts
-- full_payload for the status filter, so this is nearly free — no backfill, no new column).
--
-- cut depth %: total_price_drop is the $ delta from the FIRST ask in the chain to the
-- current list price, so the original ask = list_price + total_price_drop, and
-- pct = drop / (list_price + drop). Same active-set scoping as region_active_aggregates (047).
--
-- Run: npx tsx scripts/admin/applyMigration058.ts

CREATE OR REPLACE FUNCTION region_price_cuts(
  p_region      text,
  p_subtypes    text[]  DEFAULT NULL,
  p_min_beds    integer DEFAULT 0,
  p_min_baths   numeric DEFAULT 0,
  p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0,
  p_basement    text    DEFAULT 'any'
)
RETURNS TABLE (
  active_count   integer,
  cut_count      integer,
  median_cut_amt integer,
  median_cut_pct numeric
)
LANGUAGE sql
STABLE
SET statement_timeout = '60s'
AS $$
  WITH active AS (
    SELECT
      list_price,
      NULLIF(full_payload->>'total_price_drop', '')::numeric AS drop
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
      AND lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', ''))
          NOT IN ('sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended')
  )
  SELECT
    count(*)::int                                                                          AS active_count,
    count(*) FILTER (WHERE drop > 0)::int                                                   AS cut_count,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY drop) FILTER (WHERE drop > 0))::int   AS median_cut_amt,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (drop / (list_price + drop) * 100))
          FILTER (WHERE drop > 0 AND list_price > 0)::numeric, 1)                           AS median_cut_pct
  FROM active;
$$;

COMMENT ON FUNCTION region_price_cuts(text, text[], integer, numeric, integer, numeric, text) IS
  'Price-cut pressure for one market area: active_count, cut_count (total_price_drop>0), median $ and % cut depth among reduced listings. Same active-set scoping as region_active_aggregates (047). Scalars only (§6.3b).';
