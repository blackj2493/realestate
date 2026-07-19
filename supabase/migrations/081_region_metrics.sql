-- Migration 081: region_metrics — nightly precompute of the full base-scope /analytics
-- payload, one JSONB row per market.
--
-- Even after Tier 1 (streaming + delisted index) and Tier 2 (sold-dynamics flat columns),
-- a big region's COLD /analytics load still runs the 11-RPC batch live, gated by the
-- residual slow ones (region_avm_reliability ~6.8s and region_listing_outcomes ~5s for
-- Toronto). This table lets the default (all-types, base-scope) view read a single
-- precomputed row instead — the same idea as market_summary (048), but the whole
-- AnalyticsInitial payload rather than just the leaderboard scalars.
--
-- Written nightly by scripts/admin/refresh-region-metrics.ts (after the daily sync, via
-- dailySync.ts). Read by getRegionMetricsCached() with a 72h freshness cap, so a stale/absent
-- row transparently falls back to the live cached RPCs. Custom type/scope views always go live.
--
-- Aggregates only (no listing rows) — the §6.3(b) display cap does not apply; the page's VOW
-- gate runs before any read.

CREATE TABLE IF NOT EXISTS region_metrics (
  region      text PRIMARY KEY,
  -- Full base-scope AnalyticsInitial (assembleAnalyticsInitial): trend, stats, dom, cuts,
  -- dynamics, rental, avm, inventory, seasonality, outcomes, ledger.
  payload     jsonb       NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE region_metrics IS
  'Nightly precompute of the base-scope /analytics AnalyticsInitial payload, one row per market (081). Refreshed by refresh-region-metrics.ts; read by getRegionMetricsCached with a 72h freshness cap (else live fallback). Custom type/scope views bypass this.';
