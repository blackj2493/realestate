-- Migration 023: Create property_estimates table (CLAUDE.md §3C, §4, §10)
-- Purpose: Precompute the PureProperty Estimate (AVM) + resolved living area per
--          ACTIVE listing so the Compare page (and any list/grid) can read a
--          ready-made estimate in ONE batched point-lookup instead of running the
--          multi-query AVM live. This is what makes Compare's "vs Estimate" row and
--          its corrected $/sqft render instantly.
--
-- Why precompute: calculateAVM() does 3 Supabase lookups (anchor + audit +
-- coefficients) PLUS living-area resolution per listing. Doing that live for up to
-- 4 compared columns is seconds of latency; the values change at most daily, so we
-- compute them nightly (deterministic, no AI — §4) and cache the scalars here.
--
-- Populated by scripts/admin/refresh-property-estimates.ts after the daily sync
-- (same shared model core as the request-time detail page → values match exactly).
-- raw_vow_sold is read READ-ONLY for the anchor and is never altered here (§12).
--
-- Read path: Compare batch-reads WHERE listing_key IN (…) — an indexed PK lookup,
-- no scan at request time (respects the Disk IO budget).

CREATE TABLE IF NOT EXISTS property_estimates (
  listing_key           TEXT PRIMARY KEY,            -- listings.listing_key (active only)

  -- PureProperty Estimate (AVM). NULL when the market is below the anchor/R² gate
  -- (too few comps) — render "Insufficient comps", never a fabricated number.
  estimated_value       NUMERIC(12, 2),
  confidence            TEXT,                         -- 'HIGH' | 'MEDIUM' | 'LOW'
  r2_score              NUMERIC(5, 4),                -- market model accuracy (0–1)
  anchor_price          NUMERIC(12, 2),              -- 90-day median / Base_Price anchor
  total_adjustment_pct  NUMERIC(8, 5),               -- exp(Σβz) − 1 (feature adjustment)

  -- Resolved gross living area + price/sqft. BuildingAreaTotal is ~never filled for
  -- houses, so gla_sqft comes from measured room dimensions → calibrated bucket →
  -- range midpoint (resolveLivingArea). ppsf = list_price / gla_sqft.
  gla_sqft              NUMERIC(10, 2),
  ppsf                  NUMERIC(10, 2),

  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE property_estimates IS
  'Nightly-precomputed PureProperty Estimate (AVM) + resolved GLA/$psf per active listing. Shares the request-time model core (src/lib/avm/calculator.ts estimateFromMarketData) so cached values match the detail page. NULL estimate = market below the anchor/R² gate. Read by Compare in one batched PK lookup.';
