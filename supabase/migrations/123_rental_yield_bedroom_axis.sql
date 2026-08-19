-- 123: region_rental_yield — put rent and price on the SAME bedroom axis.
--
-- The two halves of this RPC have never agreed on what "beds" means. The rent CTE
-- grouped by `bedrooms_total`, which the feed defines as above-grade PLUS below-grade.
-- The price CTE groups by `bedrooms_above_grade`. They then join on beds. So a 2+den
-- lease landed in the beds=3 rent bucket while a 2+den SALE landed in the beds=2
-- price bucket, and every published gross yield divided one population's rent by a
-- different population's price.
--
-- The error runs one way — rents were read off a bucket one bedroom too large, which
-- is systematically too cheap for the price it was divided into, so every row
-- understated the return. Measured read-only against live source data:
--
--   Toronto      2bd  4.36% -> 4.87%      5bd  3.14% -> 3.68%
--   Mississauga  2bd  5.35% -> 5.89%      5bd  3.24% -> 4.54%   (40% relative)
--   Brampton     1bd  5.00% -> 5.39%      5bd  3.27% -> 3.77%
--
-- Migration 122 made the fix possible by storing above-grade cohorts. Pointing the
-- rent CTE at `bedrooms_above` puts both sides on "whole bedrooms above grade", so a
-- 2+den's rent and a 2+den's sale price now meet in the same bucket.
--
-- Grouping by `bedrooms_above` deliberately pools den and non-den homes back
-- together, because the price side pools them too — matching the axis is the whole
-- point. The finer den split stays available to the listing-page grid, which has a
-- price for each cell and does not have to join across two populations.
--
-- THIS MOVES PUBLISHED NUMBERS. Every rental-return figure on /analytics rises.
-- Requires 122 to be applied first.

CREATE OR REPLACE FUNCTION public.region_rental_yield(p_region text, p_subtypes text[] DEFAULT NULL::text[])
 RETURNS TABLE(beds integer, typical_rent integer, rent_sample integer, median_price bigint, price_sample integer, gross_yield_pct numeric)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '60s'
AS $function$
  WITH rent AS (
    SELECT
      bedrooms_above AS beds,
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
      AND bedrooms_above IS NOT NULL   -- 123: SPLIT rows; merged rows would double-count
      AND avg_rent > 0
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND bedrooms_above BETWEEN 1 AND 5
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
