-- Migration 119: rent_market_stats — precomputed CLOSED-rent aggregates for /data/rents.
--
-- WHY THIS EXISTS: nobody in Canada publishes what a HOUSE actually rents for.
--   * TRREB's quarterly rental report covers condo APARTMENTS only, at region level.
--   * Zumper / PadMapper / RentCafe carry ASKING rents — not what the lease closed at.
--   * CMHC covers purpose-built rental, annually, not the MLS market.
-- We hold the closed lease price for houses and condos alike, by neighbourhood. That gap
-- is the whole reason for this tracker, which is why property_group is a first-class
-- dimension rather than a filter.
--
-- Source: read-only aggregation over raw_vow_sold WHERE transaction_type IN
-- ('For Lease','For Sub-Lease'). raw_vow_sold is never altered (CLAUDE.md §12).
-- Refreshed nightly by scripts/admin/refresh-rent-market-stats.ts after the daily sync.
--
-- GRAIN: one row per (city, area, property_group, bedrooms_band).
-- bedrooms_band 'ALL' carries the headline row for the neighbourhood; 1/2/3/4 carry the
-- per-bedroom detail. Measured 2026-08-14, area x group x bedrooms leaves only 67 house
-- cells at n>=20 versus 210 for area x group, so the ALL row is what the board leads with
-- and the bedroom rows fill in where the sample supports it. A rent median across mixed
-- bedroom counts is otherwise meaningless, so the ALL row also stores median_bedrooms —
-- the reader must be able to see WHAT is being priced.
--
-- yoy_pct is NULL until the trailing window has a comparable prior period. It is written
-- only when BOTH periods clear MIN_SAMPLE, so a thin prior year cannot manufacture a
-- headline percentage.

CREATE TABLE IF NOT EXISTS public.rent_market_stats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  city              TEXT NOT NULL,
  -- TRREB CityRegion. Blank for Waterloo Region/Brantford, where the feed ships no
  -- CityRegion on either side — those roll up under the city instead of vanishing.
  area              TEXT NOT NULL,
  property_group    TEXT NOT NULL,                 -- 'House' | 'Condo'
  bedrooms_band     TEXT NOT NULL,                 -- 'ALL' | '1' | '2' | '3' | '4' (4 = 4+)

  -- Closed rent, $/month. MEDIAN never mean: one $14k executive lease drags an average
  -- and tells the reader nothing.
  median_rent       INTEGER,
  p25_rent          INTEGER,
  p75_rent          INTEGER,
  -- Typical size behind the headline number, so "median rent" is interpretable.
  median_bedrooms   NUMERIC(4, 1),

  -- Asking vs closed. Measured near-zero in aggregate (median ratio 1.0000, ~63% close at
  -- exactly the asking rent), which is itself the finding — it is stored so the page can
  -- SAY that rather than imply a discount that is not there.
  pct_below_ask     NUMERIC(5, 1),
  median_discount   INTEGER,                       -- $/mo, among those that closed below ask

  yoy_pct           NUMERIC(6, 2),                 -- NULL unless both periods clear MIN_SAMPLE
  sample_count      INTEGER NOT NULL DEFAULT 0,
  prior_sample      INTEGER NOT NULL DEFAULT 0,
  window_months     INTEGER NOT NULL DEFAULT 12,

  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (city, area, property_group, bedrooms_band)
);

-- The board reads the whole 'ALL' slate in one query and orders by sample; the per-bedroom
-- rows are fetched for the areas already on screen.
CREATE INDEX IF NOT EXISTS idx_rent_market_stats_board
  ON public.rent_market_stats (bedrooms_band, property_group, sample_count DESC);

CREATE INDEX IF NOT EXISTS idx_rent_market_stats_lookup
  ON public.rent_market_stats (city, area, property_group);

COMMENT ON TABLE public.rent_market_stats IS
  'Precomputed closed-rent aggregates per neighbourhood x House/Condo x bedroom band. '
  'Source: raw_vow_sold lease rows. Refreshed nightly by refresh-rent-market-stats.ts. '
  'Aggregate statistics only — never listing-level rows.';
