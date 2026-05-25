-- Migration 022: Create avm_sqft_calibration table
-- Purpose: Precomputed "typical real living area" per market + sub-type + MLS range
--          bucket, used by the AVM when a listing has no usable room dimensions
--          (CLAUDE.md §3C, §4, §10).
--
-- Why: BuildingAreaTotal is ~never filled for houses, so the AVM fell back to the
-- midpoint of a coarse, often-inflated LivingAreaRange bucket ("3500-5000" → an
-- assumed 4,250 sqft) and over-valued large homes by hundreds of thousands. The
-- request-time fix measures GLA from per-room dimensions; this table is the
-- FALLBACK for listings whose rooms are missing/sparse — the data-calibrated
-- median grossed-up room-sum GLA for the listing's (CityRegion, sub-type, bucket).
--
-- Ground truth = grossed room-sum GLA (the only real size signal; exact
-- BuildingAreaTotal does not exist for residential). Aggregated from ACTIVE
-- listings that carry stored room dimensions. raw_vow_sold has no room data and is
-- never read/altered here (CLAUDE.md §12). Refreshed nightly by
-- scripts/admin/refresh-sqft-calibration.ts after the daily sync.
--
-- Read path: one indexed PK point-lookup per listing page (no scan at request
-- time — respects the Disk IO budget).

CREATE TABLE IF NOT EXISTS avm_sqft_calibration (
  city_region        TEXT NOT NULL,            -- verbatim full_payload.CityRegion (column is ~94% null)
  property_sub_type  TEXT NOT NULL,            -- normalizePropertySubType() canonical key
  living_area_range  TEXT NOT NULL,            -- verbatim MLS bucket label, e.g. "3500-5000"

  median_gla         NUMERIC(10, 2) NOT NULL,  -- median grossed room-sum GLA (sqft) for the cohort
  sample_count       INTEGER NOT NULL DEFAULT 0,

  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (city_region, property_sub_type, living_area_range)
);

COMMENT ON TABLE avm_sqft_calibration IS
  'Precomputed median grossed room-sum GLA per (CityRegion, normalized sub-type, LivingAreaRange bucket). AVM no-rooms fallback so a coarse MLS range never drives the estimate. Refreshed nightly from active listings'' room dimensions; raw_vow_sold is not used.';

-- Reuse the shared trigger fn from migration 007 (CREATE OR REPLACE there).
DROP TRIGGER IF EXISTS update_avm_sqft_calibration_updated_at ON avm_sqft_calibration;
CREATE TRIGGER update_avm_sqft_calibration_updated_at
  BEFORE UPDATE ON avm_sqft_calibration
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
