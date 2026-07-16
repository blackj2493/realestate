-- Migration 062: two dormant tables → market surfaces (Phase-2 green items).
--
--   region_rental_yield    — rental_market_index (006/030) is populated (5.3k rows) but
--                            never surfaced. Per-bedroom typical rent for the area, paired
--                            with the trailing-12mo median sold price to give a GROSS YIELD.
--   region_avm_reliability — avm_audit_report (006) holds per-cohort R²/MAE keyed by
--                            city_region (neighbourhood). Map neighbourhood→city via
--                            listings, weight by sales analysed → one honest area confidence.
--
-- Both are additive read-only functions (CREATE OR REPLACE, no schema change, no backfill).
-- Run: npx tsx scripts/admin/applyPhase2Migrations.ts

-- ── region_rental_yield ────────────────────────────────────────────────────────────────
-- Rent comes from the 'city' tier when p_region is a municipality, or the 'nbhd' tier when
-- it is a neighbourhood — never mixed, so no double count. Yield beds are matched on
-- bedrooms_above_grade (the analytics scope's bed convention); labelled "typical" since rent
-- and sold beds are only approximately comparable.
CREATE OR REPLACE FUNCTION region_rental_yield(
  p_region   text,
  p_subtypes text[] DEFAULT NULL
)
RETURNS TABLE (
  beds            integer,
  typical_rent    integer,   -- sample-weighted monthly rent across matched sub-types
  rent_sample     integer,
  median_price    bigint,    -- trailing-12mo median sold price for this bed count
  price_sample    integer,
  gross_yield_pct numeric    -- (rent*12)/median_price*100, null when either side is thin
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
  'Per-bedroom typical monthly rent (rental_market_index city/nbhd tier) + gross yield vs trailing-12mo median sold price. Yield null when the sold sample for that bed count is thin (<5). Approximate: rent and sold bed counts are only loosely comparable.';

-- ── region_avm_reliability ─────────────────────────────────────────────────────────────
-- avm_audit_report is keyed by city_region only. Resolve which city_regions belong to the
-- requested area via listings (city / city_region / Toronto-district roll-up), then weight
-- R²/MAE by total_sales_analyzed → one area-level confidence figure.
CREATE OR REPLACE FUNCTION region_avm_reliability(
  p_region   text,
  p_subtypes text[] DEFAULT NULL
)
RETURNS TABLE (
  cohort_count   integer,
  sales_analyzed integer,
  wavg_r2        numeric,   -- sales-weighted R² (0..1)
  wavg_mae_pct   numeric    -- sales-weighted mean abs error, as a %
)
LANGUAGE sql
STABLE
SET statement_timeout = '60s'
AS $$
  WITH regionset AS (
    SELECT DISTINCT lower(city_region) AS cr
    FROM listings
    WHERE city_region IS NOT NULL
      AND (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
      )
  )
  SELECT
    count(*)::int,
    coalesce(sum(a.total_sales_analyzed), 0)::int,
    round((sum(a.model_accuracy_score * a.total_sales_analyzed)
           / NULLIF(sum(a.total_sales_analyzed), 0))::numeric, 3),
    round((sum(a.average_error_margin * a.total_sales_analyzed)
           / NULLIF(sum(a.total_sales_analyzed), 0) * 100)::numeric, 1)
  FROM avm_audit_report a
  WHERE lower(a.city_region) IN (SELECT cr FROM regionset)
    AND a.total_sales_analyzed > 0
    AND (p_subtypes IS NULL OR a.property_sub_type = ANY (p_subtypes));
$$;

COMMENT ON FUNCTION region_avm_reliability(text, text[]) IS
  'Sales-weighted AVM confidence (R² + MAE%) for a market area. Maps avm_audit_report city_region cohorts to the requested city via listings (city / city_region / Toronto-district). CountyOrParish roll-up intentionally omitted to keep the listings scan index-driven.';
