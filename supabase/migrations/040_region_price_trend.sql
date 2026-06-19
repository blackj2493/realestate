-- Migration 040: region_price_trend RPC — SQL-side monthly sold-trend aggregation.
--
-- Replaces the request-time pagination in app/api/market/price-trend/route.ts, which
-- pulled up to 20,000 rows from raw_vow_sold in 1,000-row pages (up to ~8 sequential
-- round-trips for a high-volume city) and computed medians in Node. Each page was a
-- full Parallel Seq Scan of the 223k-row table because the WHERE clause used
-- `city ILIKE x OR city_region ILIKE x` — ILIKE cannot use the case-sensitive btree
-- indexes that exist on raw_vow_sold, and there is no index on `city` at all. Measured
-- cost: ~1.2s/page × 8 pages ≈ 9.6s for Brampton alone (the dominant cause of the
-- /analytics page taking 8-10s to show data).
--
-- This RPC does the whole job in ONE pass with percentile_cont, returning a compact
-- JSONB { points:[{month,medianPrice,medianPpsf,sales}], summary:{...} }. Mirrors
-- region_active_aggregates (migration 020): scalars/aggregates only — no listing rows,
-- so the 100-listing display cap (§6.3b) does not apply. raw_vow_sold stays read-only
-- (§12); this only SELECTs from it.
--
-- The lag-robust monthlyVelocity window (avg of the 6 settled months 2..7 back) is left
-- in Node (route.ts) — it depends on "today" and is unit-tested there.
--
-- Pairs with migration 041, which adds the lower(city)/lower(city_region) functional
-- indexes that let the WHERE clause below become a fast BitmapOr index scan instead of
-- a seq scan. The RPC is correct without them (just slower).
--
-- Instant DDL (CREATE FUNCTION only) — editor-safe.
-- Run: npx tsx scripts/admin/applyMigration040.ts   (or paste into the SQL editor)

CREATE OR REPLACE FUNCTION region_price_trend(
  p_region      text,
  p_subtypes    text[]  DEFAULT NULL,
  p_min_beds    integer DEFAULT 0,
  p_min_baths   numeric DEFAULT 0,
  p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0,
  p_months      integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT
      close_price::numeric            AS price,
      list_price::numeric             AS list,
      purchase_contract_date::date    AS pcd,
      building_area_total::numeric    AS sqft
    FROM raw_vow_sold
    WHERE (lower(city) = lower(p_region) OR lower(city_region) = lower(p_region))
      -- $50k floor excludes lease/rental rows that leak into the sold feed.
      AND close_price >= 50000
      AND purchase_contract_date >= (current_date - make_interval(months => p_months))
      -- Exact PropertySubType match (incl. trailing-space "Semi-Detached "); NULL ⇒ all.
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      -- Floors mirror the old Node `.gte` semantics (NULL excluded; 0 ⇒ no floor).
      AND (p_min_beds = 0     OR bedrooms_above_grade    >= p_min_beds)
      AND (p_min_baths = 0    OR bathrooms_total_integer >= p_min_baths)
      AND (p_min_parking = 0  OR parking_total           >= p_min_parking)
      AND (p_min_frontage = 0 OR lot_width               >= p_min_frontage)
  ),
  monthly AS (
    SELECT
      to_char(date_trunc('month', pcd), 'YYYY-MM')                                   AS month,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::int                 AS "medianPrice",
      -- NULLIF guards against a literal 0 sqft; rows without usable sqft are filtered.
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price / NULLIF(sqft, 0))
            FILTER (WHERE sqft > 0))::int                                            AS "medianPpsf",
      count(*)::int                                                                  AS sales
    FROM base
    GROUP BY 1
    ORDER BY 1
  ),
  -- Trailing-90-day sold-to-list heat. Ratio sanity band (0.5,2) drops data-entry errors.
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
        -- Coverage-gated: trustworthy only with >=50% list coverage AND >=10 priced sales.
        'soldToListPct',     CASE WHEN with_list >= 10 AND with_list::numeric / NULLIF(sales90, 0) >= 0.5
                                  THEN round(ratio_avg * 100, 1) ELSE NULL END,
        'pctOverAsking',     CASE WHEN with_list >= 10 AND with_list::numeric / NULLIF(sales90, 0) >= 0.5
                                  THEN round(over_ask::numeric / with_list * 100, 1) ELSE NULL END
      ) FROM s90)
  );
$$;

COMMENT ON FUNCTION region_price_trend(text, text[], integer, numeric, integer, numeric, integer) IS
  'Monthly median sold price/$psf + 90d sold-to-list summary for one market area, computed full-population in a single pass (percentile_cont). Returns JSONB {points,summary} — scalars only, no listing rows. Replaces the Node-side pagination in /api/market/price-trend.';
