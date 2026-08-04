-- 107: region_price_trend / region_sold_dynamics — complete months only + banded-sqft $/psf.
--
-- Two defects, one root pattern each:
--
-- (1) PARTIAL-MONTH BUCKET (Market Pulse "wild swing"). The monthly CTE grouped
--     everything up to current_date, so the in-progress month rendered as a real
--     data point. Measured 2026-08-03 for Brampton: the "2026-08" bucket held
--     TWO sales (median $1,006,750) against ~450-sale settled months (~$841k) —
--     a 2-home "median" spiking the chart, the scorecard headline (latest
--     point), and the smoothed YoY (last-3-months window). Fix: month-aligned
--     lower bound and the monthly buckets stop at the current month boundary, so
--     the RPC returns exactly p_months COMPLETE months. The 90-day summary
--     (sold-to-list / sales90) keeps its rolling window including today — a
--     rolling aggregate over ~hundreds of sales is not composition-noisy the
--     way a 2-row month bucket is, and sales90 feeds the thin-sample gate,
--     which should see the freshest count.
--
-- (2) DEAD $/SQFT (silent-null). TRREB went banded-only on residential sqft:
--     building_area_total coverage in raw_vow_sold collapsed 90% → 32% → 0%
--     over Apr → May → Jun 2026, so medianPpsf has been NULL since June on the
--     pulse $/SQFT toggle and the /analytics dispersion panel. The feed's band
--     midpoint is ALREADY a populated flat column: living_area_range (ingester
--     parseLivingAreaRange, "1500-2000" → 1750; ~99% coverage every month,
--     history included). COALESCE onto it — flat-column read, no raw_payload
--     detoast (measured 17s/region when parsed from payload at query time).
--     Months mix exact-sqft rows (older) with band-midpoint rows (newer); both
--     pass through the same 50–5000 $/psf sanity band downstream.
--
-- Node side: market-price-trend cache key v13 → v14, market-sold-dynamics
-- v1 → v2 (src/lib/market/aggregates.ts), so stale spiky entries are never
-- served post-deploy.
--
-- NOT touched here: sold_city_comps (AVM peer-anchor rung 2) also reads
-- building_area_total and needs the same coalesce — separate change, since AVM
-- comp selection deserves its own backtest before the input distribution moves.
--
-- Definitions below are edits of the LIVE pg_get_functiondef output (which
-- already includes 089 aliasing + 106 transaction_type), not of older migration
-- files. Signatures unchanged → in-place CREATE OR REPLACE, no overloads.

CREATE OR REPLACE FUNCTION public.region_price_trend(p_region text, p_subtypes text[] DEFAULT NULL::text[], p_min_beds integer DEFAULT 0, p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0, p_min_frontage numeric DEFAULT 0, p_months integer DEFAULT 24, p_basement text DEFAULT 'any'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '60s'
AS $function$
  WITH base AS (
    SELECT
      close_price::numeric            AS price,
      list_price::numeric             AS list,
      purchase_contract_date::date    AS pcd,
      -- 107: exact sqft when the feed still gave one; else the banded midpoint
      -- (living_area_range flat column). Never raw_payload at query time.
      COALESCE(NULLIF(building_area_total, 0), living_area_range)::numeric AS sqft
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
      AND transaction_type = 'For Sale'
      AND close_price >= 50000
      -- 107: month-aligned window start, so the oldest bucket is a full month too.
      AND purchase_contract_date >= date_trunc('month', current_date) - make_interval(months => p_months)
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
    -- 107: the in-progress month is never a chart point (a 2-sale "median" is
    -- composition noise, not a trend). The s90 summary below still sees it.
    WHERE pcd < date_trunc('month', current_date)
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
$function$;

CREATE OR REPLACE FUNCTION public.region_sold_dynamics(p_region text, p_subtypes text[] DEFAULT NULL::text[], p_min_beds integer DEFAULT 0, p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0, p_min_frontage numeric DEFAULT 0, p_months integer DEFAULT 12, p_basement text DEFAULT 'any'::text)
 RETURNS TABLE(sold_count integer, median_dom integer, p25_dom integer, p75_dom integer, median_ppsf integer, p25_ppsf integer, p75_ppsf integer, ppsf_sample integer, ask_gap_median numeric, ask_gap_sample integer, under_ask_share numeric)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '60s'
AS $function$
  WITH base AS (
    SELECT
      close_price::numeric         AS price,
      -- 107: exact sqft when fed; else banded midpoint (see region_price_trend).
      COALESCE(NULLIF(building_area_total, 0), living_area_range)::numeric AS sqft,
      -- Flat original_list_price (080); raw_payload fallback keeps un-backfilled rows correct.
      COALESCE(original_list_price, NULLIF(raw_payload->>'OriginalListPrice', '')::numeric) AS olp,
      -- Flat days_on_market (board value); else flat listing_contract_date span; else the
      -- raw_payload equivalents (transition-window fallback only). Once backfilled the flat
      -- columns win and raw_payload is never detoasted.
      COALESCE(
        days_on_market,
        CASE WHEN listing_contract_date IS NOT NULL
             THEN GREATEST(0, purchase_contract_date - listing_contract_date)
             ELSE NULL END,
        NULLIF(raw_payload->>'DaysOnMarket', '')::numeric,
        CASE WHEN raw_payload->>'ListingContractDate' ~ '^\d{4}-\d{2}-\d{2}'
             THEN GREATEST(0, purchase_contract_date - (raw_payload->>'ListingContractDate')::date)
             ELSE NULL END
      )                            AS dom
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
      AND transaction_type = 'For Sale'
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
  dom_band AS (
    SELECT dom FROM base WHERE dom IS NOT NULL AND dom >= 0 AND dom <= 730
  ),
  ppsf_band AS (
    SELECT price / sqft AS ppsf FROM base WHERE sqft > 0 AND price / sqft BETWEEN 50 AND 5000
  ),
  gap_band AS (
    SELECT (price - olp) / olp AS gap, (price < olp) AS under
    FROM base
    WHERE olp > 50000 AND (price - olp) / olp BETWEEN -0.6 AND 0.6
  )
  SELECT
    (SELECT count(*)::int FROM base),
    (SELECT round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY dom))::int  FROM dom_band),
    (SELECT round(percentile_cont(0.25) WITHIN GROUP (ORDER BY dom))::int  FROM dom_band),
    (SELECT round(percentile_cont(0.75) WITHIN GROUP (ORDER BY dom))::int  FROM dom_band),
    (SELECT round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY ppsf))::int FROM ppsf_band),
    (SELECT round(percentile_cont(0.25) WITHIN GROUP (ORDER BY ppsf))::int FROM ppsf_band),
    (SELECT round(percentile_cont(0.75) WITHIN GROUP (ORDER BY ppsf))::int FROM ppsf_band),
    (SELECT count(*)::int FROM ppsf_band),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) * 100)::numeric, 1) FROM gap_band),
    (SELECT count(*)::int FROM gap_band),
    (SELECT round(avg(CASE WHEN under THEN 1 ELSE 0 END), 3) FROM gap_band);
$function$;
