-- Migration 080: flatten region_sold_dynamics' raw_payload detoast.
--
-- region_sold_dynamics (061) read three fields out of the big raw_payload JSONB in its
-- SELECT list — OriginalListPrice, DaysOnMarket, ListingContractDate — which forces a TOAST
-- detoast+decompress of raw_payload for EVERY matched sold row. That per-row detoast is the
-- whole cost: measured 25s for Toronto (and slow even warm), vs region_price_trend (059) —
-- same 4-way region WHERE, but a flat-only SELECT — at ~0.6s. The 067/068 work did exactly
-- this for the active side; this finishes the sold side.
--
-- 1. Add three flat columns (nullable, additive — existing columns/AVM anchor untouched).
-- 2. Rewrite the base CTE to read them, with a COALESCE(flat, raw_payload…) fallback so the
--    function is correct even for rows not yet backfilled (and for the brief window before
--    the ingester deploy). Once backfilled, the COALESCE short-circuits at execution and the
--    raw_payload branch is never evaluated → no detoast. The WHERE is unchanged: its
--    CountyOrParish branch is served by idx_vow_sold_county_lower (047), not a detoast scan
--    (proven by 059 being fast with the identical WHERE).
--
-- Backfill: scripts/admin/backfillSoldFlatColumns.ts (keyset-batched). New rows populate via
-- the ingester (extractSoldListingData / upsertSoldListings).

ALTER TABLE raw_vow_sold
  ADD COLUMN IF NOT EXISTS original_list_price   numeric,
  ADD COLUMN IF NOT EXISTS days_on_market        numeric,
  ADD COLUMN IF NOT EXISTS listing_contract_date date;

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
  ask_gap_median   numeric,
  ask_gap_sample   integer,
  under_ask_share  numeric
)
LANGUAGE sql
STABLE
SET statement_timeout = '60s'
AS $$
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
$$;

COMMENT ON FUNCTION region_sold_dynamics(text, text[], integer, numeric, integer, numeric, integer, text) IS
  'Trailing-window (p_months, default 12) sold-side dynamics for one market area: time-to-sell (DaysOnMarket p25/median/p75), original-ask->sold gap (median % + under-ask share), and close $psf dispersion (p25/median/p75). Same scope/region match as region_price_trend (059). Reads flat original_list_price/days_on_market/listing_contract_date (080) with a raw_payload fallback; raw_vow_sold read-only aside from those additive flat columns (§12).';
