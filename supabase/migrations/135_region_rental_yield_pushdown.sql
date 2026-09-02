-- 135 — region_rental_yield: filter the region BEFORE the basis pick.
--
-- Migration 133 taught this RPC to prefer signed-lease rows over asking rows with a
-- DISTINCT ON over rental_market_index — over the WHOLE table, with every filter applied
-- afterwards. The same migration's ETL then tripled the table on its first live run
-- (2026-08-31: 94,493 rows across three bases), so every call now paid a full-table sort
-- before touching a single region row. Ottawa — already the slowest region (51
-- region_aliases members and a raw_payload county detoast in the price CTE) — crossed the
-- API statement timeout at 9.3s. computeRentalYield throws on error, region_metrics
-- stored `rental: null`, and the canary reported "Ottawa: no rental yield rows" for a
-- region whose rows were sitting in the table.
--
-- The fix moves the region / bedrooms / sub-type predicates INSIDE the pick. Every one of
-- those columns is part of the DISTINCT ON key, so filtering before or after the pick
-- selects the same rows — the sort just runs over one region's cohorts instead of 94k.
-- `avg_rent > 0` is deliberately NOT pushed down: it filters the PICKED value, and moving
-- it inside would let a lower-priority basis win a cohort whose closed row has no rent —
-- a behaviour change this migration must not make.
--
-- Body is otherwise byte-for-byte the live definition (pg_get_functiondef, 2026-09-01 —
-- the RPCs drift from migration files, so the live def is the base, mig-132 rule).
-- Same signature ⇒ CREATE OR REPLACE, grants untouched. Reversible: re-apply 133's body.

CREATE OR REPLACE FUNCTION public.region_rental_yield(p_region text, p_subtypes text[] DEFAULT NULL::text[])
 RETURNS TABLE(beds integer, typical_rent integer, rent_sample integer, median_price bigint, price_sample integer, gross_yield_pct numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH region_rows AS (
    -- Region + cohort-key predicates only. All of these columns are part of the
    -- DISTINCT ON key below, so this prefilter cannot change which row wins a cohort.
    SELECT match_tier, city, city_region, county, property_sub_type,
           sub_type_family, bedrooms_total, bedrooms_above, den, bathrooms,
           basis, avg_rent, sample_count
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
      AND bedrooms_above IS NOT NULL   -- 123: SPLIT rows; merged rows would double-count
      AND bedrooms_above BETWEEN 1 AND 5
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
  ),
  one_per_cohort AS (
    SELECT DISTINCT ON (match_tier, city, city_region, county, property_sub_type,
                        sub_type_family, bedrooms_total, bedrooms_above, den, bathrooms)
           bedrooms_above, avg_rent, sample_count
      FROM region_rows
     ORDER BY match_tier, city, city_region, county, property_sub_type,
              sub_type_family, bedrooms_total, bedrooms_above, den, bathrooms,
              CASE basis WHEN 'closed_12' THEN 1 WHEN 'closed_24' THEN 2 ELSE 3 END
  ),
  rent AS (
    SELECT
      bedrooms_above AS beds,
      round(sum(avg_rent * greatest(sample_count, 1)) / sum(greatest(sample_count, 1)))::int AS rent,
      sum(coalesce(sample_count, 0))::int AS rent_n
    FROM one_per_cohort
    -- Post-pick on purpose: a cohort whose WINNING basis row carries no rent is dropped,
    -- never silently replaced by a lower-priority basis (mig 133 semantics).
    WHERE avg_rent > 0
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

COMMENT ON FUNCTION public.region_rental_yield(text, text[]) IS
  'Per-bedroom typical rent (rental_market_index, closed-basis preferred per cohort — '
  'mig 133) + gross yield vs 12mo median sold price. Region filter runs BEFORE the '
  'DISTINCT ON basis pick (mig 135) — the 2026-08-31 Ottawa canary red was this RPC '
  'timing out on a full-table sort.';
