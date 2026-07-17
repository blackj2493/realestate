-- Migration 070: region_price_events_summary — recent multi-cut ledger activity.
--
-- Reads price_events (migration 069) for a market area over a trailing window: how many
-- price cuts, across how many distinct properties, median cut depth, and how many
-- properties cut 2+ times (chasing the market). Region match on flat city / city_region /
-- Toronto-district (price_events has no raw_payload → no CountyOrParish). Prospective data:
-- returns zeros until the nightly capture accrues events.
--
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 070_region_price_events_summary.sql

CREATE OR REPLACE FUNCTION region_price_events_summary(
  p_region text,
  p_months integer DEFAULT 3
)
RETURNS TABLE (
  cut_events           integer,
  cut_properties       integer,
  median_cut_pct       numeric,
  median_cut_amt       numeric,
  multi_cut_properties integer
)
LANGUAGE sql
STABLE
SET statement_timeout = '30s'
AS $$
  WITH ev AS (
    SELECT listing_key, old_price, delta
    FROM price_events
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
      )
      AND event_date >= current_date - make_interval(months => p_months)
      AND delta < 0 AND old_price > 0
  ),
  per_prop AS (SELECT listing_key, count(*) AS n FROM ev GROUP BY listing_key)
  SELECT
    (SELECT count(*)::int FROM ev),
    (SELECT count(*)::int FROM per_prop),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY (-delta) / old_price))::numeric * 100, 1) FROM ev),
    (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY -delta))::numeric, 0) FROM ev),
    (SELECT count(*)::int FROM per_prop WHERE n >= 2);
$$;

COMMENT ON FUNCTION region_price_events_summary(text, integer) IS
  'Trailing-window multi-cut ledger summary from price_events (069): cut count, distinct cutting properties, median cut depth (% and $), and count of properties that cut 2+ times. Region match: city / city_region / Toronto-district.';
