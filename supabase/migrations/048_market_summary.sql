-- Migration 048: market_summary — nightly-precomputed base-scope market aggregates.
--
-- WHY: the Submarket Leaderboard / Region Scorecard / Market Pulse read active-inventory
-- aggregates (cap rate, active/stale counts) + the sold price-trend via the
-- region_active_aggregates / region_price_trend RPCs. Those RPCs scan the 175k-row
-- `listings` (and raw_vow_sold) and DETOAST full_payload jsonb — Toronto's base call is
-- ~43s, OVER the app's 30s Supabase fetch timeout. They were wrapped in a 24h
-- unstable_cache, but that cache is LAZY: the first visitor each day pays the full cost,
-- and because 43s > the 30s fetch abort, the computation never finishes → the cache never
-- fills → every first visitor fails. The leaderboard makes it worse by firing all ~15
-- markets concurrently (they contend and hit the 60s statement_timeout).
--
-- FIX (architectural): the underlying data only changes once a day (the nightly sync), so
-- precompute the base-scope (no-filter) aggregates for every market ONCE after the sync
-- into this table, and serve the read path from a single indexed SELECT — O(1), no live
-- aggregation, no detoast, no timeout. The slow RPC still runs, but in a background job
-- with no user waiting (refresh-market-summary.ts). Filtered (beds/baths/…) scopes stay on
-- the live RPC + 24h lazy cache — that long tail matches far fewer rows and is fast anyway.
--
-- SECURITY: cap-rate data is VOW-gated. RLS is enabled with NO policies, so only the
-- service-role client (which bypasses RLS) can touch it — the leaderboard reads it via the
-- service-role client BEHIND the VOW consumer gate; anon PostgREST access stays blocked.
--
-- Run: npx tsx scripts/admin/applyMigration048.ts   (or paste into the SQL editor)

CREATE TABLE IF NOT EXISTS market_summary (
  region          text PRIMARY KEY,
  active_count    integer,
  stale_count     integer,
  cap_sample      integer,
  median_cap_rate numeric,
  avg_cap_rate    numeric,
  top_cap_rate    numeric,
  -- region_price_trend base-scope result: { points: [...], summary: {...} }.
  trend           jsonb,
  computed_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE market_summary ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: service-role only (bypasses RLS). Keeps VOW-gated
-- cap-rate aggregates off the anon PostgREST surface.

COMMENT ON TABLE market_summary IS
  'Nightly-precomputed base-scope (no-filter) active-inventory aggregates + sold trend per market area. Refreshed by scripts/admin/refresh-market-summary.ts after the daily sync; read by /api/market/leaderboard so the read path never runs the slow region_*_aggregates RPCs live. Service-role only (RLS, no policies).';
