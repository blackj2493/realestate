-- Migration 072: region_listing_outcomes — corrected sell-through / withdrawal.
--
-- The 066 version over-counted "withdrawn" (Brampton read 71% / 29% sell-through, really
-- ~46%). Two fixes:
--   1. SALE ONLY — raw_vow_delisted mixes For Sale + For Lease; ~1/3 of delist events are
--      cancelled RENTAL listings that were being counted against SALE sell-through. Now
--      `transaction_type NOT LIKE '%lease%'` (drops lease + sub-lease).
--   2. EXCLUDE CURRENTLY-ACTIVE — a property that de-listed then RELISTED and is still on
--      the market hasn't "given up". Exclude any de-listed address that appears in the
--      current active listings (via the flat listings.norm_address from migration 071 — no
--      detoast, Toronto-safe). Relist→sold was already excluded (address in sold set).
-- So `failed` = distinct SALE property that de-listed, never sold in-window, AND is not
-- currently relisted. Region match for delisted/listings is city/city_region/Toronto
-- (no CountyOrParish — those tables lack raw_payload).
--
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 072_region_listing_outcomes_fix.sql

CREATE OR REPLACE FUNCTION region_listing_outcomes(
  p_region   text,
  p_subtypes text[]  DEFAULT NULL,
  p_months   integer DEFAULT 12
)
RETURNS TABLE (
  window_months     integer,
  sold_count        integer,
  failed_count      integer,
  failure_rate      numeric,
  median_failed_dom integer
)
LANGUAGE sql
STABLE
SET statement_timeout = '60s'
AS $$
  WITH sold_addr AS (
    SELECT DISTINCT lower(trim(unparsed_address)) AS addr
    FROM raw_vow_sold
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (lower(city) >= lower(p_region) || ' ' AND lower(city) < lower(p_region) || chr(33)
            AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$'))
        OR lower(raw_payload->>'CountyOrParish') = lower(p_region)
      )
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
$$;

COMMENT ON FUNCTION region_listing_outcomes(text, text[], integer) IS
  'Property-level SALE sell-through / withdrawal (migration 072): distinct SALE addresses that de-listed, never sold in-window, AND are not currently relisted, ÷ (those + distinct sold). Excludes lease terminations (transaction_type) and still-active relists (listings.norm_address, 071). Region: city/city_region/Toronto (delisted+listings have no CountyOrParish).';
