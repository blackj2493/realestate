-- Migration 061: region_sold_dynamics — three sold-side Phase-2 metrics in ONE pass.
--
-- All three scan the SAME trailing-window sold set with the SAME scope filters as
-- region_price_trend (059), so computing them together is one detoast pass, not three:
--   • Time-to-sell     — median/p25/p75 of the winning listing's on-market days
--                        (raw_payload->>'DaysOnMarket', 100% populated; matches
--                        purchase_contract_date − ListingContractDate exactly). This is
--                        "how fast homes that DO sell go", distinct from active True DoM.
--   • Original-ask→sold gap — median % of (close − OriginalListPrice)/OriginalListPrice,
--                        + share that sold below their ORIGINAL ask. Buyer-leverage signal
--                        distinct from sold-to-list (17% of sold had a price change).
--   • $/sqft dispersion — p25/median/p75 close $psf band (tight = homogeneous market).
--
-- raw_vow_sold stays read-only (§12). New (single-row) function ⇒ CREATE OR REPLACE is
-- additive; no schema change, no backfill. Scope/region match is 059 verbatim
-- (city / city_region / Toronto-district roll-up 042 / CountyOrParish roll-up 047).
--
-- Run: npx tsx scripts/admin/applyPhase2Migrations.ts

CREATE OR REPLACE FUNCTION region_sold_dynamics(
  p_region       text,
  p_subtypes     text[]  DEFAULT NULL,
  p_min_beds     integer DEFAULT 0,
  p_min_baths    numeric DEFAULT 0,
  p_min_parking  integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0,
  p_months       integer DEFAULT 12,
  p_basement     text    DEFAULT 'any'
)
RETURNS TABLE (
  sold_count       integer,
  median_dom       integer,
  p25_dom          integer,
  p75_dom          integer,
  median_ppsf      integer,
  p25_ppsf         integer,
  p75_ppsf         integer,
  ppsf_sample      integer,
  ask_gap_median   numeric,   -- median % (close − OLP)/OLP, negative = sold under original ask
  ask_gap_sample   integer,
  under_ask_share  numeric    -- share (0..1) that sold strictly below their original ask
)
LANGUAGE sql
STABLE
SET statement_timeout = '60s'
AS $$
  WITH base AS (
    SELECT
      close_price::numeric                                             AS price,
      building_area_total::numeric                                     AS sqft,
      NULLIF(raw_payload->>'OriginalListPrice', '')::numeric           AS olp,
      -- Board DaysOnMarket (100% populated); fall back to computed span so a rare
      -- missing value still contributes rather than dropping the row.
      COALESCE(
        NULLIF(raw_payload->>'DaysOnMarket', '')::numeric,
        CASE WHEN raw_payload->>'ListingContractDate' ~ '^\d{4}-\d{2}-\d{2}'
             THEN GREATEST(0, purchase_contract_date - (raw_payload->>'ListingContractDate')::date)
             ELSE NULL END
      )                                                                AS dom
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
  dom_band AS (   -- sanity band [0,730] so a bad date can't skew the DoM percentiles
    SELECT dom FROM base WHERE dom IS NOT NULL AND dom >= 0 AND dom <= 730
  ),
  ppsf_band AS (
    SELECT price / sqft AS ppsf FROM base WHERE sqft > 0 AND price / sqft BETWEEN 50 AND 5000
  ),
  gap_band AS (   -- same ±60% guard the sold-to-list summary uses
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
$$;

COMMENT ON FUNCTION region_sold_dynamics(text, text[], integer, numeric, integer, numeric, integer, text) IS
  'Trailing-window (p_months, default 12) sold-side dynamics for one market area: time-to-sell (DaysOnMarket p25/median/p75), original-ask→sold gap (median % + under-ask share), and close $psf dispersion (p25/median/p75). Same scope/region match as region_price_trend (059). raw_vow_sold read-only (§12).';
