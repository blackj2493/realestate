-- Migration 120: sale_competition_stats — how often homes sell OVER the asking price,
-- by neighbourhood, for /data/over-asking.
--
-- WHY THIS EXISTS: "sold over asking" is the single most-quoted phrase in Canadian housing
-- coverage and nobody publishes the actual rate.
--   * TRREB publishes average price, sales and new listings — never the share above ask.
--   * CREA's HPI is a price index; it says nothing about outcome vs the seller's ask.
--   * WOWA and HouseSigma carry city-level supply/demand ratios, not this.
-- Redfin has published "share of homes sold above final list price" for years and it is one
-- of their most-cited series. This is the Ontario equivalent, at neighbourhood grain.
--
-- WHAT IT DELIBERATELY DOES NOT DO: it carries no days-on-market measure. /data/days-on-market
-- already owns speed-of-sale using stitched relist-adjusted True DOM. Publishing a second,
-- campaign-scoped days figure on a sibling page would put two different "how fast" numbers on
-- the same site — the exact failure the competitive close-price work (#250) was cleaning up.
-- This tracker answers one question: what happened to the PRICE relative to the ask.
--
-- Source: read-only aggregation over raw_vow_sold WHERE transaction_type='For Sale'.
-- raw_vow_sold is never altered (CLAUDE.md §12). Refreshed nightly by
-- scripts/admin/refresh-sale-competition-stats.ts after the daily sync.
--
-- GRAIN: one row per (city, area, property_group). No bedroom dimension: a bidding outcome is
-- a property-level behaviour, and slicing 972 condo cells by bedroom would push most below any
-- honest sample floor. City '' + area '' is the reserved province-wide rollup.
--
-- WHICH ASK: close_price is compared against list_price — the FINAL asking price, which is
-- what "sold over asking" means in ordinary speech and matches Redfin's definition. The
-- original ask is captured separately as pct_cut_before_sale so a reader can see how much of
-- the market repriced on the way to a sale.

CREATE TABLE IF NOT EXISTS public.sale_competition_stats (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  city                  TEXT NOT NULL,
  -- TRREB CityRegion. Blank for Waterloo Region/Brantford, where the feed ships no
  -- CityRegion — those roll up under the city rather than vanishing from the tracker.
  area                  TEXT NOT NULL,
  property_group        TEXT NOT NULL,               -- 'House' | 'Condo'

  -- The three outcomes, which sum to 100. Stored as three columns rather than one "over"
  -- share because "sold at exactly the ask" is a real and separate behaviour (~5% of the
  -- market) and folding it into "under" would overstate how often sellers concede.
  pct_over_ask          NUMERIC(5, 1),
  pct_at_ask            NUMERIC(5, 1),
  pct_under_ask         NUMERIC(5, 1),

  -- Median close/list × 100. MEDIAN not mean: Redfin uses an average and has to trim
  -- ±50% outliers to stop it lying. The median needs no such surgery.
  median_sale_to_list   NUMERIC(5, 1),

  -- Size of the move, in dollars, conditional on direction. A 20% over-ask rate means
  -- something very different at a $5k premium than at a $150k one, and the rate alone
  -- cannot distinguish them.
  median_premium        INTEGER,                     -- among sales ABOVE ask
  median_discount       INTEGER,                     -- among sales BELOW ask

  -- Share whose final ask was below their original ask: repricing pressure on the way to a
  -- sale. Distinct from /data/price-cuts, which measures cuts on listings still ACTIVE.
  pct_cut_before_sale   NUMERIC(5, 1),

  -- Change in the over-ask RATE against the prior 12 months, in percentage POINTS.
  -- Points, not percent: 18.2% against 15.0% is +3.2 points. Reporting it as "+21%" is the
  -- classic way this metric gets mangled, so the unit lives in the column name.
  yoy_over_ask_pts      NUMERIC(6, 2),

  sample_count          INTEGER NOT NULL DEFAULT 0,
  prior_sample          INTEGER NOT NULL DEFAULT 0,
  window_months         INTEGER NOT NULL DEFAULT 12,

  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (city, area, property_group)
);

-- The board reads the whole slate in one paginated pass and ranks by the over-ask rate.
CREATE INDEX IF NOT EXISTS idx_sale_competition_board
  ON public.sale_competition_stats (property_group, sample_count DESC);

CREATE INDEX IF NOT EXISTS idx_sale_competition_lookup
  ON public.sale_competition_stats (city, area, property_group);

COMMENT ON TABLE public.sale_competition_stats IS
  'Precomputed sold-vs-asking outcomes per neighbourhood x House/Condo. Source: raw_vow_sold '
  'For Sale rows, close_price vs final list_price. Refreshed nightly by '
  'refresh-sale-competition-stats.ts. Aggregate statistics only — never listing-level rows.';
