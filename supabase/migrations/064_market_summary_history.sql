-- Migration 064: market_summary_history — persist daily active-inventory snapshots.
--
-- market_summary OVERWRITES in place (one row per region, computed_at bumped each nightly
-- run), so no active-inventory history exists to trend. This table appends one dated row
-- per region per day, written by refresh-market-summary.ts right after the market_summary
-- upsert. History accrues going forward; today's point is seeded from the current snapshot.
--
-- Service-role only (RLS on, no policies) — VOW-gated, same posture as market_summary.
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 064_market_summary_history.sql

CREATE TABLE IF NOT EXISTS market_summary_history (
  region          TEXT NOT NULL,
  snapshot_date   DATE NOT NULL,
  active_count    INTEGER,
  stale_count     INTEGER,
  cap_sample      INTEGER,
  median_cap_rate NUMERIC,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (region, snapshot_date)      -- one row / region / day; same-day re-run upserts
);

CREATE INDEX IF NOT EXISTS idx_msh_region_date
  ON market_summary_history (region, snapshot_date);

ALTER TABLE market_summary_history ENABLE ROW LEVEL SECURITY;

-- Seed today's point from the current market_summary so the series is non-empty immediately.
INSERT INTO market_summary_history (region, snapshot_date, active_count, stale_count, cap_sample, median_cap_rate, computed_at)
SELECT region, (computed_at AT TIME ZONE 'UTC')::date, active_count, stale_count, cap_sample, median_cap_rate, computed_at
FROM market_summary
ON CONFLICT (region, snapshot_date) DO UPDATE SET
  active_count    = EXCLUDED.active_count,
  stale_count     = EXCLUDED.stale_count,
  cap_sample      = EXCLUDED.cap_sample,
  median_cap_rate = EXCLUDED.median_cap_rate,
  computed_at     = EXCLUDED.computed_at;

COMMENT ON TABLE market_summary_history IS
  'Daily active-inventory snapshots (active_count / stale_count / cap) per curated market, appended by refresh-market-summary.ts. Powers the inventory time-series. Seeded 2026-07-17 from market_summary; real history accrues forward.';
