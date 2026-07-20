-- 086 — condo_fee_stats: add a `meta` jsonb column.
--
-- The new 'area_trend' cohort (condo fee inflation aggregated to a neighbourhood)
-- needs a little structured context the fixed columns can't carry — the parent city
-- for display/grouping, and the p25/p75 spread of member-building trends. Rather than
-- bolt on several single-purpose columns, add one nullable jsonb bag.
--
-- Additive and nullable: existing 'area' / 'corp' rows and every current reader are
-- unaffected (getListingDetail selects explicit columns, never *).
--
-- Shape written by scripts/admin/refresh-condo-fee-stats.ts for 'area_trend':
--   { "city": "Toronto", "p25AnnualPct": 1.8, "p75AnnualPct": 5.4, "buildingCount": 61 }

ALTER TABLE condo_fee_stats
  ADD COLUMN IF NOT EXISTS meta jsonb;

COMMENT ON COLUMN condo_fee_stats.meta IS
  'Optional structured context per cohort. area_trend: { city, p25AnnualPct, p75AnnualPct, buildingCount }. Null for area/corp rows.';

-- The public condo-fee tracker lists area_trend cohorts ranked by trend; this keeps
-- that a small index scan rather than a scan of the whole table.
CREATE INDEX IF NOT EXISTS idx_condo_fee_stats_area_trend
  ON condo_fee_stats (cohort_type, pct_change_24mo DESC)
  WHERE cohort_type = 'area_trend';
