-- 106: region-metrics RPCs — exclude leases by transaction_type, not by price.
--
-- Final pass of the proxy-threshold audit (PRs #217, #218, #219). These five
-- functions each carried `close_price >= 50000`, a magnitude test standing in for
-- "this row is a sale". raw_vow_sold mixes SOLD rows with LEASED ones whose
-- close_price is a monthly rent.
--
-- The migration FILES are not a reliable source here: the proxy appears 18 times
-- across 15 of them and later migrations supersede earlier ones (097 replaces
-- 065/066, 089 replaces 040/059). Only five functions are actually live. These
-- bodies were therefore generated from pg_get_functiondef() with a single
-- mechanical substitution, so nothing is transcribed by hand and no unrelated
-- drift can creep in.
--
-- THE PRICE FLOOR IS DELIBERATELY KEPT.
-- For the AVM (#219) the floor was dropped to 1, because comps are already
-- narrowed by property_sub_type and more of them is better. These functions
-- publish market medians on /analytics, so the floor keeps its OTHER job —
-- keeping $1 placeholders and sub-$50k land out of a headline "median sale
-- price" — and the change here is purely defensive: it removes the assumption
-- that no lease will ever close above $50k. Outputs are unchanged today, and the
-- verification asserts exactly that.
--
-- ALLOWLIST, NOT DENYLIST — and deliberately the opposite of #217.
-- The search typeahead negates ("anything that is not a sale gets the lenient
-- floor") because its job is to make everything findable: an unrecognised
-- transaction type should still surface. These compute money statistics, so an
-- unrecognised type must be EXCLUDED until someone looks at it. Default toward
-- including for discovery, toward excluding for computation.
-- (region_listing_outcomes' de-listed branch uses NOT LIKE '%lease%' for its own
-- reasons; that branch is untouched here.)
--
-- Regenerate with: scripts/admin/regenRegionRpcMigration.ts


-- ---------------------------------------------------------------------------
-- region_listing_outcomes(p_region text, p_subtypes text[], p_months integer)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.region_listing_outcomes(p_region text, p_subtypes text[] DEFAULT NULL::text[], p_months integer DEFAULT 12)
 RETURNS TABLE(window_months integer, sold_count integer, failed_count integer, failure_rate numeric, median_failed_dom integer)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '60s'
AS $function$
  WITH sold_addr AS (
    SELECT DISTINCT lower(trim(unparsed_address)) AS addr
    FROM raw_vow_sold
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (lower(city) >= lower(p_region) || ' ' AND lower(city) < lower(p_region) || chr(33)
            AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        -- 097: flat-column roll-up for aliased regions (Ottawa) — no detoast.
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
        -- 097: the expensive CountyOrParish path runs ONLY for regions with no aliases,
        -- preserving prior behaviour for them while removing the detoast for Ottawa.
        OR (
          NOT EXISTS (SELECT 1 FROM region_aliases WHERE region = lower(p_region))
          AND lower(raw_payload->>'CountyOrParish') = lower(p_region)
        )
      )
      AND transaction_type = 'For Sale'
      AND close_price >= 50000
      AND purchase_contract_date >= current_date - make_interval(months => p_months)
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND unparsed_address IS NOT NULL AND trim(unparsed_address) <> ''
  ),
  active_addr AS (   -- currently on-market (relisted) — not a failure
    SELECT DISTINCT norm_address AS addr
    FROM listings
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (lower(city) >= lower(p_region) || ' ' AND lower(city) < lower(p_region) || chr(33)
            AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))          -- 088
      )
      AND list_price >= 50000
      AND norm_address IS NOT NULL AND norm_address <> ''
      AND coalesce(standard_status, '') NOT IN ('sold','closed','closed sale','leased','terminated','expired','suspended')
  ),
  del AS (
    SELECT lower(trim(unparsed_address)) AS addr, days_on_market::numeric AS dom
    FROM raw_vow_delisted
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (lower(city) >= lower(p_region) || ' ' AND lower(city) < lower(p_region) || chr(33)
            AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))          -- 088
      )
      AND delisted_date >= current_date - make_interval(months => p_months)
      AND lower(coalesce(transaction_type, '')) NOT LIKE '%lease%'   -- SALE only
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND unparsed_address IS NOT NULL AND trim(unparsed_address) <> ''
  ),
  failed AS (
    SELECT d.addr, min(d.dom) AS dom
    FROM del d
    WHERE NOT EXISTS (SELECT 1 FROM sold_addr   s WHERE s.addr = d.addr)
      AND NOT EXISTS (SELECT 1 FROM active_addr a WHERE a.addr = d.addr)
    GROUP BY d.addr
  )
  SELECT
    p_months,
    (SELECT count(*)::int FROM sold_addr),
    (SELECT count(*)::int FROM failed),
    round((SELECT count(*)::numeric FROM failed)
          / NULLIF((SELECT count(*) FROM failed) + (SELECT count(*) FROM sold_addr), 0), 3),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom))::int FROM failed WHERE dom >= 0 AND dom <= 730);
$function$;


-- ---------------------------------------------------------------------------
-- region_price_trend(p_region text, p_subtypes text[], p_min_beds integer, p_min_baths numeric, p_min_parking integer, p_min_frontage numeric, p_months integer, p_basement text)
-- ---------------------------------------------------------------------------
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
$function$;


-- ---------------------------------------------------------------------------
-- region_rental_yield(p_region text, p_subtypes text[])
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.region_rental_yield(p_region text, p_subtypes text[] DEFAULT NULL::text[])
 RETURNS TABLE(beds integer, typical_rent integer, rent_sample integer, median_price bigint, price_sample integer, gross_yield_pct numeric)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '60s'
AS $function$
  WITH rent AS (
    SELECT
      bedrooms_total AS beds,
      round(sum(avg_rent * greatest(sample_count, 1)) / sum(greatest(sample_count, 1)))::int AS rent,
      sum(coalesce(sample_count, 0))::int AS rent_n
    FROM rental_market_index
    WHERE (
        (match_tier = 'city' AND lower(city)        = lower(p_region))
     OR (match_tier = 'nbhd' AND lower(city_region) = lower(p_region))
     OR (match_tier = 'city'                                                  -- 085: Toronto districts
         AND lower(city) >= lower(p_region) || ' '
         AND lower(city) <  lower(p_region) || chr(33)
         AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
     OR (match_tier = 'city' AND lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region))))  -- 088: Ottawa areas
      )
      AND avg_rent > 0
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND bedrooms_total BETWEEN 1 AND 5
    GROUP BY 1
  ),
  price AS (
    SELECT
      bedrooms_above_grade AS beds,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY close_price)::bigint AS price,
      count(*)::int AS price_n
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
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))                          -- 088
      )
      AND transaction_type = 'For Sale'
      AND close_price >= 50000
      AND purchase_contract_date >= current_date - interval '12 months'
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND bedrooms_above_grade BETWEEN 1 AND 5
    GROUP BY 1
  )
  SELECT
    r.beds,
    r.rent,
    r.rent_n,
    p.price,
    coalesce(p.price_n, 0),
    CASE WHEN p.price > 50000 AND p.price_n >= 5
         THEN round((r.rent * 12.0) / p.price * 100, 2) ELSE NULL END
  FROM rent r
  LEFT JOIN price p ON p.beds = r.beds
  WHERE r.rent_n > 0
  ORDER BY r.beds;
$function$;


-- ---------------------------------------------------------------------------
-- region_seasonality(p_region text, p_subtypes text[])
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.region_seasonality(p_region text, p_subtypes text[] DEFAULT NULL::text[])
 RETURNS TABLE(month_num integer, sales integer, price_index_pct numeric, sold_to_list numeric)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '60s'
AS $function$
  WITH base AS (
    SELECT
      close_price::numeric                        AS price,
      list_price::numeric                         AS list,
      EXTRACT(month FROM purchase_contract_date)::int AS mon,
      EXTRACT(year  FROM purchase_contract_date)::int AS yr
    FROM raw_vow_sold
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
        -- 097: flat-column roll-up for aliased regions (Ottawa) — no detoast.
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
        -- 097: the expensive CountyOrParish path runs ONLY for regions with no aliases.
        OR (
          NOT EXISTS (SELECT 1 FROM region_aliases WHERE region = lower(p_region))
          AND lower(raw_payload->>'CountyOrParish') = lower(p_region)
        )
      )
      AND transaction_type = 'For Sale'
      AND close_price >= 50000
      AND purchase_contract_date >= current_date - interval '5 years'
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
  ),
  yearmed AS (
    SELECT yr, percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS med
    FROM base GROUP BY yr
  ),
  norm AS (
    SELECT b.mon, b.list, b.price / y.med AS rel, b.price / NULLIF(b.list, 0) AS s2l
    FROM base b JOIN yearmed y ON y.yr = b.yr
    WHERE y.med > 0
  )
  SELECT
    mon,
    count(*)::int,
    round(((percentile_cont(0.5) WITHIN GROUP (ORDER BY rel))::numeric - 1) * 100, 1),
    round((avg(s2l) FILTER (WHERE list >= 50000 AND s2l > 0.5 AND s2l < 2) * 100)::numeric, 1)
  FROM norm
  GROUP BY mon
  ORDER BY mon;
$function$;


-- ---------------------------------------------------------------------------
-- region_sold_dynamics(p_region text, p_subtypes text[], p_min_beds integer, p_min_baths numeric, p_min_parking integer, p_min_frontage numeric, p_months integer, p_basement text)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.region_sold_dynamics(p_region text, p_subtypes text[] DEFAULT NULL::text[], p_min_beds integer DEFAULT 0, p_min_baths numeric DEFAULT 0, p_min_parking integer DEFAULT 0, p_min_frontage numeric DEFAULT 0, p_months integer DEFAULT 12, p_basement text DEFAULT 'any'::text)
 RETURNS TABLE(sold_count integer, median_dom integer, p25_dom integer, p75_dom integer, median_ppsf integer, p25_ppsf integer, p75_ppsf integer, ppsf_sample integer, ask_gap_median numeric, ask_gap_sample integer, under_ask_share numeric)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '60s'
AS $function$
  WITH base AS (
    SELECT
      close_price::numeric         AS price,
      building_area_total::numeric AS sqft,
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
