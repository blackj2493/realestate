-- Migration 066: region_listing_outcomes — withdrawal / listing-failure rate.
--
-- Of the properties that LEFT the market in the trailing window, what share gave up
-- without a recorded sale. Property-level (distinct normalized address) so a
-- terminate→relist→sold chain counts once as a SALE, not a failure — the relist-inflation
-- trap. failed = de-listed (raw_vow_delisted is Terminated/Expired/Suspended only) whose
-- address never appears in raw_vow_sold in the window.
--
-- Region match: raw_vow_sold gets the full pattern (incl. CountyOrParish); raw_vow_delisted
-- has NO raw_payload, so it matches city / city_region / Toronto-district only — county-based
-- regions (e.g. Ottawa) will under-count the delisted side (noted in the panel source line).
-- Flat columns only, no detoast. Run: npx tsx scripts/admin/applyMigrationFiles.ts 066_region_listing_outcomes.sql

CREATE OR REPLACE FUNCTION region_listing_outcomes(
  p_region   text,
  p_subtypes text[]  DEFAULT NULL,
  p_months   integer DEFAULT 12
)
RETURNS TABLE (
  window_months     integer,
  sold_count        integer,   -- distinct sold properties
  failed_count      integer,   -- distinct withdrawn properties (never sold in window)
  failure_rate      numeric,   -- failed / (failed + sold), 0..1
  median_failed_dom integer    -- median days the failed listings sat before giving up
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
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
        OR lower(raw_payload->>'CountyOrParish') = lower(p_region)
      )
      AND close_price >= 50000
      AND purchase_contract_date >= current_date - make_interval(months => p_months)
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND unparsed_address IS NOT NULL AND trim(unparsed_address) <> ''
  ),
  del AS (
    SELECT lower(trim(unparsed_address)) AS addr, days_on_market::numeric AS dom
    FROM raw_vow_delisted
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
      )
      AND delisted_date >= current_date - make_interval(months => p_months)
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
      AND unparsed_address IS NOT NULL AND trim(unparsed_address) <> ''
  ),
  failed AS (
    SELECT d.addr, min(d.dom) AS dom          -- one row per withdrawn property
    FROM del d
    WHERE NOT EXISTS (SELECT 1 FROM sold_addr s WHERE s.addr = d.addr)
    GROUP BY d.addr
  )
  SELECT
    p_months,
    (SELECT count(*)::int FROM sold_addr),
    (SELECT count(*)::int FROM failed),
    round(
      (SELECT count(*)::numeric FROM failed)
      / NULLIF((SELECT count(*) FROM failed) + (SELECT count(*) FROM sold_addr), 0), 3),
    (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dom))::int
       FROM failed WHERE dom >= 0 AND dom <= 730);
$$;

COMMENT ON FUNCTION region_listing_outcomes(text, text[], integer) IS
  'Property-level withdrawal/failure rate over a trailing window: distinct addresses that de-listed (Terminated/Expired/Suspended) without ever selling, ÷ (those + distinct sold). Relist→sold counts as a sale. Delisted side lacks CountyOrParish, so county-based regions under-count.';
