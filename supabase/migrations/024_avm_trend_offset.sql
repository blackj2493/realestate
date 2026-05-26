-- Migration 024: AVM trend index + community offset
-- Purpose: Two precomputed tables that let the AVM anchor be both LOCAL in level and
--          CURRENT in trend without hard-borrowing prices across communities
--          (CLAUDE.md §3C, §4, §10). Source: raw_vow_sold (READ-ONLY, scalar
--          columns only — respects the Disk IO budget; §12).
--
-- Why: the old anchor (90-day same-community median, gated at ≥5 comps) returned
-- "Estimate unavailable" on ~45% of cohorts (Brampton/Mississauga prod probe
-- 2026-05-25) and over-valued in a falling market because static Base_Price/matrices
-- carry training-time level. Splitting price into CITY trend g(city,sub,t) + LOCAL
-- offset δ(community) + subject feature premium fixes BOTH unavailability AND
-- over-estimation: every community gets a current prior (g + δ) even with zero
-- recent comps, and recent local comps are de-staled before being blended in.
--
-- 1. avm_trend_index — feature-adjusted log-price level per (city × sub-type ×
--    half-year), last 24 mo. Verified-noisy at the community level (per-community
--    quarterly ρ to city ≈ 0.08–0.22 across Brampton + Mississauga), so we only
--    track this at city × sub-type × HALF-YEAR cadence. The ±5–8 pp residual is
--    carried in the predictive band; not papered over by a smoother index.
--
-- 2. avm_community_offset — long-window log-offset of (community vs its city) at
--    the same sub-type. Computed from the SAME feature-adjusted ℓ-series so the
--    trend cancels in the ratio (no training date required). Persistent level —
--    Lorne Park stays ~+0.7, Malton stays ~−0.4 vs Mississauga; only the city
--    trend moves them in unison.
--
-- Read path: 1 city-trend row + 1 community-offset row per AVM call (indexed PK
-- point lookups). No scans at request time. raw_vow_sold schema untouched (§12).

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 1: City × sub-type log-level trend (semi-annual)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS avm_trend_index (
  city               TEXT NOT NULL,           -- raw_vow_sold.city (municipality)
  property_sub_type  TEXT NOT NULL,           -- normalizePropertySubType() canonical key
  period_end         DATE NOT NULL,           -- last day of the half-year bucket (YYYY-06-30 or YYYY-12-31)

  level_log          DOUBLE PRECISION NOT NULL, -- robust median of feature-adjusted ln(close_price)
  n_sales            INTEGER NOT NULL DEFAULT 0,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (city, property_sub_type, period_end)
);

COMMENT ON TABLE avm_trend_index IS
  'Feature-adjusted ln(close_price) robust median per (city × sub-type × half-year), last 24 mo. The "motion" half of the level/trend decomposition the AVM anchor uses. City-aggregate cadence — per-community quarterly trend is too noisy (ρ ≈ 0.08–0.22 to city). Refreshed nightly from raw_vow_sold (read-only) by refresh-avm-trend-offset.ts.';

CREATE INDEX IF NOT EXISTS idx_avm_trend_index_city_sub_period
  ON avm_trend_index (city, property_sub_type, period_end DESC);

DROP TRIGGER IF EXISTS update_avm_trend_index_updated_at ON avm_trend_index;
CREATE TRIGGER update_avm_trend_index_updated_at
  BEFORE UPDATE ON avm_trend_index
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 2: Community offset vs its city (persistent level)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS avm_community_offset (
  city_region        TEXT NOT NULL,           -- verbatim raw_vow_sold.city_region (CityRegion)
  property_sub_type  TEXT NOT NULL,           -- normalizePropertySubType() canonical key

  delta_log          DOUBLE PRECISION NOT NULL, -- median(ℓ_i_community − g(city,sub,period_of_i))
  n_sales            INTEGER NOT NULL DEFAULT 0,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (city_region, property_sub_type)
);

COMMENT ON TABLE avm_community_offset IS
  'Persistent log-offset of (community vs its city) per sub-type, computed from feature-adjusted ln(close_price) so the city trend cancels in the ratio (no training date required). The "level" half of the decomposition — Lorne Park ≈ +0.7, Malton ≈ −0.4 vs Mississauga. With avm_trend_index, lets the AVM produce a current prior even when 0 recent local comps exist. Refreshed nightly by refresh-avm-trend-offset.ts.';

DROP TRIGGER IF EXISTS update_avm_community_offset_updated_at ON avm_community_offset;
CREATE TRIGGER update_avm_community_offset_updated_at
  BEFORE UPDATE ON avm_community_offset
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
