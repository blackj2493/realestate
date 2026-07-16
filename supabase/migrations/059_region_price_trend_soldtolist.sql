-- Migration 059: region_price_trend += per-month soldToList (Tier-1 B, sold-to-list trend).
--
-- Adds a monthly sold-to-list % to each trend point so the 24-month chart can plot
-- sold/list over time (today it is only a single 90-day summary number). Body is
-- migration 047's region_price_trend VERBATIM with ONE added column in the `monthly`
-- CTE — to_jsonb(m) already serialises the whole row, so the new key flows into each
-- point automatically. Backward-compatible (existing readers ignore it); returns jsonb,
-- so the signature is unchanged ⇒ CREATE OR REPLACE, no DROP. The CountyOrParish indexes
-- (migration 047) already exist; this only replaces the function. GUCs reset on REPLACE,
-- so statement_timeout is re-declared. region_active_aggregates is NOT touched.
--
-- Run: npx tsx scripts/admin/applyMigration059.ts

CREATE OR REPLACE FUNCTION region_price_trend(
  p_region      text,
  p_subtypes    text[]  DEFAULT NULL,
  p_min_beds    integer DEFAULT 0,
  p_min_baths   numeric DEFAULT 0,
  p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0,
  p_months      integer DEFAULT 24,
  p_basement    text    DEFAULT 'any'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET statement_timeout = '60s'
AS $$
  WITH base AS (
    SELECT
      close_price::numeric            AS price,
      list_price::numeric             AS list,
      purchase_contract_date::date    AS pcd,
      building_area_total::numeric    AS sqft
    FROM raw_vow_sold
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
        OR lower(raw_payload->>'CountyOrParish') = lower(p_region)
      )
      AND close_price >= 50000
      AND purchase_contract_date >= (current_date - make_interval(months => p_months))
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND (p_min_beds = 0     OR bedrooms_above_grade    >= p_min_beds)
      AND (p_min_baths = 0    OR bathrooms_total_integer >= p_min_baths)
      AND (p_min_parking = 0  OR parking_total           >= p_min_parking)
      AND (p_min_frontage = 0 OR lot_width               >= p_min_frontage)
      AND (
        p_basement = 'any'
        OR (p_basement = 'finished'   AND basement_tier BETWEEN 1 AND 5)
        OR (p_basement = 'unfinished' AND basement_tier BETWEEN 6 AND 8)
      )
  ),
  monthly AS (
    SELECT
      to_char(date_trunc('month', pcd), 'YYYY-MM')                                   AS month,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::int                 AS "medianPrice",
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price / NULLIF(sqft, 0))
            FILTER (WHERE sqft > 0))::int                                            AS "medianPpsf",
      count(*)::int                                                                  AS sales,
      -- Per-month sold-to-list % (same sanity band as the 90d summary). NULL when a month
      -- has no priced sales in-band, so the trend line simply gaps rather than lying.
      round(avg(price / list) FILTER (WHERE list >= 50000 AND price / list > 0.5 AND price / list < 2) * 100, 1)
                                                                                     AS "soldToList"
    FROM base
    GROUP BY 1
    ORDER BY 1
  ),
  s90 AS (
    SELECT
      count(*)::int AS sales90,
      count(*) FILTER (WHERE list >= 50000 AND price / list > 0.5 AND price / list < 2)::int AS with_list,
      avg(price / list) FILTER (WHERE list >= 50000 AND price / list > 0.5 AND price / list < 2) AS ratio_avg,
      count(*) FILTER (WHERE list >= 50000 AND price / list > 0.5 AND price / list < 2 AND price > list)::int AS over_ask
    FROM base
    WHERE pcd >= current_date - 90
  )
  SELECT jsonb_build_object(
    'points',
      coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM monthly m), '[]'::jsonb),
    'summary',
      (SELECT jsonb_build_object(
        'sales90',           sales90,
        'listPriceCoverage', round(CASE WHEN sales90 > 0 THEN with_list::numeric / sales90 ELSE 0 END, 2),
        'soldToListPct',     CASE WHEN with_list >= 10 AND with_list::numeric / NULLIF(sales90, 0) >= 0.5
                                  THEN round(ratio_avg * 100, 1) ELSE NULL END,
        'pctOverAsking',     CASE WHEN with_list >= 10 AND with_list::numeric / NULLIF(sales90, 0) >= 0.5
                                  THEN round(over_ask::numeric / with_list * 100, 1) ELSE NULL END
      ) FROM s90)
  );
$$;

COMMENT ON FUNCTION region_price_trend(text, text[], integer, numeric, integer, numeric, integer, text) IS
  'Monthly median sold price/$psf/sales + per-month soldToList (059) + 90d sold-to-list summary for one market area. Region match: exact city/city_region, Toronto district roll-up (042), CountyOrParish roll-up (047). Returns JSONB {points,summary} — scalars only.';
