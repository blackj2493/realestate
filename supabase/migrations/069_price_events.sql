-- Migration 069: price_events (multi-cut ledger) + listing_price_state.
--
-- The existing region_price_cuts (058) shows NET original→last drop on active listings.
-- This captures EVERY price change going forward so we can trend cut velocity and flag
-- properties that cut repeatedly (chasing the market). Populated by the standalone nightly
-- job scripts/admin/capture-price-events.ts, which diffs listings.list_price (flat, no
-- detoast) against listing_price_state and appends an event on change. Prospective — the
-- first run seeds state (no events); the ledger accrues forward.
--
-- Both service-role only (RLS on, no policies) — VOW-gated.
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 069_price_events.sql

CREATE TABLE IF NOT EXISTS price_events (
  id                BIGSERIAL PRIMARY KEY,
  listing_key       TEXT NOT NULL,
  property_hash     TEXT,
  event_date        DATE NOT NULL,
  old_price         NUMERIC NOT NULL,
  new_price         NUMERIC NOT NULL,
  delta             NUMERIC NOT NULL,   -- new − old (negative = cut)
  city              TEXT,
  city_region       TEXT,
  property_sub_type TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (listing_key, event_date, new_price)  -- idempotent within a day
);

CREATE INDEX IF NOT EXISTS idx_price_events_city_date ON price_events (city, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_price_events_hash ON price_events (property_hash);

ALTER TABLE price_events ENABLE ROW LEVEL SECURITY;

-- Last-known list price per active listing, so the nightly job can detect a change.
CREATE TABLE IF NOT EXISTS listing_price_state (
  listing_key       TEXT PRIMARY KEY,
  last_price        NUMERIC NOT NULL,
  property_hash     TEXT,
  city              TEXT,
  city_region       TEXT,
  property_sub_type TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE listing_price_state ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE price_events IS
  'Multi-cut price ledger (migration 069): one row per detected list-price change, appended nightly by capture-price-events.ts. Complements region_price_cuts (058, net drop).';
COMMENT ON TABLE listing_price_state IS
  'Last-known list price per listing (migration 069) — the diff baseline for capture-price-events.ts.';
