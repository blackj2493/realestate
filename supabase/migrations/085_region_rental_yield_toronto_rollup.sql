-- 085 — region_rental_yield: roll up Toronto's district-coded rental rows.
--
-- WHY: rental_market_index stores Toronto rents keyed by district ('Toronto C01',
-- 'Toronto C02', …), but the `rent` CTE only matched `city = p_region` exactly, so
-- region_rental_yield('Toronto') matched ZERO rent rows and returned nothing — Toronto
-- (the #1 market) had no rental yield on /analytics or the public rent-vs-buy tracker,
-- even though 592 Toronto rent rows across 9 bed counts exist.
--
-- The `price` CTE already applies the standard Toronto district roll-up; this brings the
-- `rent` CTE into line with the same index-usable prefix range + `[cwe]##` recheck. The CTE
-- already sample-weights avg_rent across matched rows, so district rows aggregate into one
-- city-wide Toronto rent per bed count — mirroring how the price side aggregates districts.
--
-- Ottawa is intentionally NOT addressed here: its rental rows are keyed by OREB *area names*
-- in `city` (e.g. 'Ottawa Centre', 'Glebe - Ottawa East and Area') with no district pattern,
-- the same structural gap that makes Ottawa sell-through N/A. Non-Toronto single-name cities
-- (Mississauga, etc.) are unaffected — the regex never matches their exact-city rows.
-- Signature unchanged.

CREATE OR REPLACE FUNCTION region_rental_yield(
  p_region   text,
  p_subtypes text[] DEFAULT NULL
)
RETURNS TABLE (
  beds            integer,
  typical_rent    integer,
  rent_sample     integer,
  median_price    bigint,
  price_sample    integer,
  gross_yield_pct numeric
)
LANGUAGE sql
STABLE
SET statement_timeout = '60s'
AS $$
  WITH rent AS (
    SELECT
      bedrooms_total AS beds,
      round(sum(avg_rent * greatest(sample_count, 1)) / sum(greatest(sample_count, 1)))::int AS rent,
      sum(coalesce(sample_count, 0))::int AS rent_n
    FROM rental_market_index
    WHERE (
        (match_tier = 'city' AND lower(city)        = lower(p_region))
     OR (match_tier = 'nbhd' AND lower(city_region) = lower(p_region))
     OR (match_tier = 'city'                                                  -- 085: Toronto district roll-up
         AND lower(city) >= lower(p_region) || ' '
         AND lower(city) <  lower(p_region) || chr(33)
         AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
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
      )
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
$$;

COMMENT ON FUNCTION region_rental_yield(text, text[]) IS
  'Gross rental yield by bed count for one market. Rent from rental_market_index (city/nbhd tier + Toronto district roll-up, 085), price from raw_vow_sold trailing 12mo. Scalars only (§6.3b).';
