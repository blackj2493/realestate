-- 097 — region_listing_outcomes + region_seasonality: skip the CountyOrParish detoast
-- for aliased regions (the 089 pattern, applied to the two RPCs still carrying it).
--
-- FOUND BY THE DATA-HEALTH CANARY (2026-07-26): "Ottawa: sellThroughPct is null (not a
-- known gap)". The nightly refresh printed "Ottawa ok (30.0s), failures: 0" — the region
-- succeeded but computeAnalyticsInitial's Promise.allSettled silently nulled the failing
-- slices. Silent-null failure mode, one level down: slice-level nulls inside a green
-- region. Payload inspection showed TWO Ottawa slices null: outcomes AND seasonality
-- (the canary only names sellThroughPct because seasonality isn't on /data's board).
--
-- ROOT CAUSE: both functions scan raw_vow_sold with a naked
-- `lower(raw_payload->>'CountyOrParish')` OR-branch — a FULL raw_payload detoast on every
-- scanned row. region_listing_outcomes measured 15–19s standalone (2026-07-26); under the
-- nightly's parallel 11-slice batch both exceeded the ceiling and were dropped. Same
-- failure 089 fixed for region_price_trend (~21s → 382ms). region_seasonality (065) also
-- had NO alias branch at all — its header even claims "no detoast" while line 41 detoasts.
--
-- EQUIVALENCE VERIFIED on prod before this migration, over the WHOLE raw_vow_sold table
-- (close >= 50k): CountyOrParish matched 21,157 Ottawa rows; the alias list matched the
-- same 21,157; 0 unique to either side (12-month window: 10,017 = 10,017, also exact).
-- Regions with NO aliases keep the CountyOrParish branch — behaviour byte-identical.
--
-- Only the region-match WHERE clauses change; every other line of both functions is
-- byte-identical to 088/065. (outcomes' del/active_addr CTEs never had the branch.)
--
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 097_alias_no_detoast_outcomes_seasonality.sql

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
        -- 097: flat-column roll-up for aliased regions (Ottawa) — no detoast.
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
        -- 097: the expensive CountyOrParish path runs ONLY for regions with no aliases,
        -- preserving prior behaviour for them while removing the detoast for Ottawa.
        OR (
          NOT EXISTS (SELECT 1 FROM region_aliases WHERE region = lower(p_region))
          AND lower(raw_payload->>'CountyOrParish') = lower(p_region)
        )
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
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))          -- 088
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
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))          -- 088
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
  'Property-level SALE sell-through / withdrawal. Distinct SALE addresses that de-listed, never sold in-window, AND are not currently relisted, ÷ (those + distinct sold). Region: city/city_region/Toronto districts/region_aliases; CountyOrParish only for regions with no aliases (097 — removes the raw_payload detoast that timed the Ottawa slice out of the nightly).';

-- ── region_seasonality: same treatment — alias branch added (065 never had one) and the
-- CountyOrParish detoast gated to alias-less regions. Everything else byte-identical to 065.
CREATE OR REPLACE FUNCTION region_seasonality(
  p_region   text,
  p_subtypes text[] DEFAULT NULL
)
RETURNS TABLE (
  month_num       integer,
  sales           integer,
  price_index_pct numeric,  -- median (sale ÷ year-median) − 1, as %
  sold_to_list    numeric
)
LANGUAGE sql
STABLE
SET statement_timeout = '60s'
AS $$
  WITH base AS (
    SELECT
      close_price::numeric                        AS price,
      list_price::numeric                         AS list,
      EXTRACT(month FROM purchase_contract_date)::int AS mon,
      EXTRACT(year  FROM purchase_contract_date)::int AS yr
    FROM raw_vow_sold
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
        -- 097: flat-column roll-up for aliased regions (Ottawa) — no detoast.
        OR lower(city) = ANY (ARRAY(SELECT member_city FROM region_aliases WHERE region = lower(p_region)))
        -- 097: the expensive CountyOrParish path runs ONLY for regions with no aliases.
        OR (
          NOT EXISTS (SELECT 1 FROM region_aliases WHERE region = lower(p_region))
          AND lower(raw_payload->>'CountyOrParish') = lower(p_region)
        )
      )
      AND close_price >= 50000
      AND purchase_contract_date >= current_date - interval '5 years'
      AND (p_subtypes IS NULL OR property_sub_type = ANY (p_subtypes))
  ),
  yearmed AS (
    SELECT yr, percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS med
    FROM base GROUP BY yr
  ),
  norm AS (
    SELECT b.mon, b.list, b.price / y.med AS rel, b.price / NULLIF(b.list, 0) AS s2l
    FROM base b JOIN yearmed y ON y.yr = b.yr
    WHERE y.med > 0
  )
  SELECT
    mon,
    count(*)::int,
    round(((percentile_cont(0.5) WITHIN GROUP (ORDER BY rel))::numeric - 1) * 100, 1),
    round((avg(s2l) FILTER (WHERE list >= 50000 AND s2l > 0.5 AND s2l < 2) * 100)::numeric, 1)
  FROM norm
  GROUP BY mon
  ORDER BY mon;
$$;

COMMENT ON FUNCTION region_seasonality(text, text[]) IS
  'Monthly (1–12) seasonality over the last 5 years of raw_vow_sold: sales volume, year-normalized price index (median sale ÷ year-median − 1, %), and sold-to-list. Region: city/city_region/Toronto districts/region_aliases; CountyOrParish only for regions with no aliases (097 — Ottawa previously matched ONLY via the detoast branch and timed out of the nightly).';
