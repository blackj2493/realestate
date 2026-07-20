-- 089 — region_price_trend: match aliased regions on the FLAT city column instead of
-- detoasting raw_payload for CountyOrParish.
--
-- FOUND BY THE DATA-HEALTH CANARY (087), on its first real run: Ottawa's stored trend had
-- ZERO points while every other market had 25, so Ottawa rendered no median/average price,
-- no months-of-supply, no sold-to-list and no temperature — on /analytics AND the public
-- price-rankings tracker. Nothing errored; the precompute simply stored an empty trend and
-- served it. This is the same silent-null failure mode as the Toronto price-cuts bug (084).
--
-- ROOT CAUSE: Ottawa's sold rows only matched via `lower(raw_payload->>'CountyOrParish')`,
-- which forces a FULL raw_payload detoast on every scanned row. That put the RPC at ~21s
-- standalone, and under the nightly refresh's concurrent 11-RPC batch it exceeded its own
-- 60s statement_timeout and came back empty.
--
-- FIX: now that region_aliases (088) exists, Ottawa can be matched on the flat `city`
-- column. Verified EXACTLY equivalent over a 3-month window: 3,601 rows via CountyOrParish,
-- 3,601 via the alias list, 0 rows unique to either side.
--
-- The CountyOrParish branch is kept for any region that has NO aliases, so behaviour is
-- byte-identical everywhere else; it is skipped entirely for aliased regions, which is what
-- removes the detoast. Both subqueries are uncorrelated, so Postgres evaluates each once as
-- an InitPlan rather than per row.

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
LANGUAGE sql STABLE SET statement_timeout = '60s'
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
        -- 089: flat-column roll-up for aliased regions (Ottawa) — no detoast.
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
        -- 089: the expensive CountyOrParish path now runs ONLY for regions with no aliases,
        -- preserving prior behaviour for them while removing the detoast for Ottawa.
        OR (
          NOT EXISTS (SELECT 1 FROM region_aliases WHERE region = lower(p_region))
          AND lower(raw_payload->>'CountyOrParish') = lower(p_region)
        )
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
      round(avg(price))::int                                                         AS "avgPrice",
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price / NULLIF(sqft, 0))
            FILTER (WHERE sqft > 0))::int                                            AS "medianPpsf",
      count(*)::int                                                                  AS sales,
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
  'Monthly sold price/ppsf/volume/sold-to-list trend + 90d summary. Region match: city/city_region/Toronto districts/region_aliases (089, flat column) and CountyOrParish only for regions without aliases. Scalars only (§6.3b).';
