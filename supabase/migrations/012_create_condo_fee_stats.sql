-- Migration 012: Create condo_fee_stats table
-- Purpose: Precomputed condo maintenance-fee aggregates for the Individual Listing Page
--          "Condo Fee Stability" card (CLAUDE.md §3C, §10).
--
-- Two cohort kinds in one table (cohort_type discriminator):
--   'area' → fee/sqft distribution for a neighbourhood (CityRegion) + condo sub-type.
--            Powers the "is this fee normal for the area?" benchmark gauge.
--   'corp' → fee/sqft trend over the trailing window for a single condo corporation.
--            Powers the same-building fee trajectory. Only written when the corp has
--            enough sold units (sparse buildings → no corp row → benchmark-only at read time).
--
-- Source: read-only aggregation over raw_vow_sold (~2yr VOW sold condos). This table is
-- SEPARATE — raw_vow_sold is never altered (CLAUDE.md §12). Refreshed nightly by
-- scripts/admin/refresh-condo-fee-stats.ts after the daily sync.
--
-- Read path: src/app/api/property/[id]/route.ts does two indexed point-lookups per
-- condo page load (no raw_vow_sold scan at request time — respects the Disk IO budget).

CREATE TABLE IF NOT EXISTS condo_fee_stats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_type       TEXT NOT NULL,                 -- 'area' | 'corp'
  cohort_key        TEXT NOT NULL,                 -- CityRegion (area) | CondoCorpNumber (corp)
  property_sub_type TEXT NOT NULL DEFAULT 'ALL',   -- condo sub-type for 'area'; 'ALL' for 'corp'

  -- Area distribution (fee per sqft, $/sqft/month). NULL for corp rows.
  median_fee_psf    NUMERIC(10, 4),
  p25_fee_psf       NUMERIC(10, 4),
  p75_fee_psf       NUMERIC(10, 4),

  -- Corp trend. trend_buckets = [{ period, median_psf, n }, ...] oldest→newest.
  -- pct_change_24mo = cumulative % change of building median fee/sqft across the window.
  trend_buckets     JSONB DEFAULT '[]'::jsonb,
  pct_change_24mo   NUMERIC(8, 4),

  inclusions_mixed  BOOLEAN DEFAULT false,         -- cohort mixes utility-inclusive/exclusive fees
  sample_count      INTEGER DEFAULT 0,             -- sold units behind this row
  window_months     INTEGER DEFAULT 24,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (cohort_type, cohort_key, property_sub_type)
);

CREATE INDEX IF NOT EXISTS idx_condo_fee_stats_lookup
  ON condo_fee_stats (cohort_type, cohort_key);

COMMENT ON TABLE condo_fee_stats IS
  'Precomputed condo fee/sqft aggregates (area distribution + corp trend) for the listing-page Fee Stability card. Refreshed nightly from raw_vow_sold; raw_vow_sold itself is never modified.';

-- Reuse the shared trigger fn from migration 007 (CREATE OR REPLACE there).
DROP TRIGGER IF EXISTS update_condo_fee_stats_updated_at ON condo_fee_stats;
CREATE TRIGGER update_condo_fee_stats_updated_at
  BEFORE UPDATE ON condo_fee_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
