-- Migration 042: roll Toronto's district codes up to the "Toronto" market in both region RPCs.
--
-- TRREB stores the City of Toronto NOT as a bare "Toronto" but as 35 district codes —
-- "Toronto C01".."Toronto C15" (Central), "W01".."W10" (West), "E01".."E11" (East). So the
-- exact-match region filter `lower(city) = 'toronto'` returned ZERO rows, and /analytics +
-- the Submarket Leaderboard showed "—" for the single biggest market (0 of 38,178 sold /
-- 39,481 active rows matched). Toronto is the ONLY municipality split this way.
--
-- Fix: match the district codes via an index-usable range on lower(city)
--   lower(city) >= 'toronto ' AND lower(city) < 'toronto' || chr(33)        -- '!' = next char after space
-- (served by idx_vow_sold_city_lower_pcd / idx_listings_city_lower as a Bitmap Index Scan, so
-- no seq-scan regression for the clean cities), plus a regex recheck that keeps ONLY the
-- "[CWE]##" district pattern. The recheck is essential: a bare prefix would also swallow
-- "Hamilton Township" (a separate municipality near Cobourg) into "Hamilton". Verified on prod:
-- the recheck keeps all 38,178/39,481 Toronto rows and excludes Hamilton Township (0 kept).
--
-- p_region is validated upstream to a safe charset (REGION_RE — letters/digits/space/-/'/.),
-- so the concatenated regex cannot be malformed; '.'/'-' are harmless and the range pre-filter
-- already bounds the recheck to the one municipality's prefix.
--
-- Only the WHERE region clause changes in each function; all other logic is preserved verbatim
-- from migration 040 (region_price_trend) and the live region_active_aggregates (migration 031).
-- Instant DDL (CREATE OR REPLACE) — editor-safe.
-- Run: npx tsx scripts/admin/applyMigration042.ts

-- ── region_price_trend (sold side, raw_vow_sold) ─────────────────────────────────────
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
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        -- Toronto district-code roll-up (see migration header). Index-usable range + strict recheck.
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
      )
      AND close_price >= 50000
      AND purchase_contract_date >= (current_date - make_interval(months => p_months))
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND (p_min_beds = 0     OR bedrooms_above_grade    >= p_min_beds)
      AND (p_min_baths = 0    OR bathrooms_total_integer >= p_min_baths)
      AND (p_min_parking = 0  OR parking_total           >= p_min_parking)
      AND (p_min_frontage = 0 OR lot_width               >= p_min_frontage)
  ),
  monthly AS (
    SELECT
      to_char(date_trunc('month', pcd), 'YYYY-MM')                                   AS month,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::int                 AS "medianPrice",
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price / NULLIF(sqft, 0))
            FILTER (WHERE sqft > 0))::int                                            AS "medianPpsf",
      count(*)::int                                                                  AS sales
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

-- ── region_active_aggregates (active side, listings) ─────────────────────────────────
CREATE OR REPLACE FUNCTION region_active_aggregates(
  p_region      text,
  p_subtypes    text[]  DEFAULT NULL,
  p_min_beds    integer DEFAULT 0,
  p_min_baths   numeric DEFAULT 0,
  p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0
)
RETURNS TABLE (
  active_count    integer,
  cap_sample      integer,
  median_cap_rate numeric,
  avg_cap_rate    numeric,
  top_cap_rate    numeric,
  stale_count     integer
)
LANGUAGE sql
STABLE
AS $$
  WITH active AS (
    SELECT cap_rate_est AS cap, is_stale
    FROM listings
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        -- Toronto district-code roll-up (see migration header). Index-usable range + strict recheck.
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
      )
      AND list_price >= 50000
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      AND (p_min_beds <= 0 OR NULLIF(full_payload->>'BedroomsTotal', '')::numeric >= p_min_beds)
      AND (p_min_baths <= 0 OR NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric >= p_min_baths)
      AND (p_min_parking <= 0 OR NULLIF(full_payload->>'ParkingTotal', '')::numeric >= p_min_parking)
      AND (p_min_frontage <= 0 OR NULLIF(full_payload->>'LotWidth', '')::numeric >= p_min_frontage)
      AND lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', ''))
          NOT IN ('sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended')
  )
  SELECT
    count(*)::int AS active_count,
    count(*) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::int AS cap_sample,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY cap)
          FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::numeric, 2) AS median_cap_rate,
    round(avg(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2) AS avg_cap_rate,
    round(max(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2) AS top_cap_rate,
    count(*) FILTER (WHERE is_stale)::int AS stale_count
  FROM active;
$$;
