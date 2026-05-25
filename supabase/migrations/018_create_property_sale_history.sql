-- Migration 018: Create property_sale_history table (+ recreate idx_vow_sold_hash)
-- Purpose: Precomputed prior-sale ledger per physical property for the Individual
--          Listing Page "Sale History" + "Price Timeline" (CLAUDE.md §3C, §10).
--
-- One row per property (keyed by property_hash — the SAME hash generatePropertyHash()
-- writes for both `listings` and `raw_vow_sold`, so the read path is a single PK
-- point-lookup, no scan, respecting the Disk IO budget). Sale events are stored as a
-- newest-first JSONB array so the per-listing read is one row.
--
-- Source: read-only aggregation over raw_vow_sold (~2yr+ VOW sold archive). This table
-- is SEPARATE — raw_vow_sold is never altered (CLAUDE.md §12). Refreshed nightly by
-- scripts/admin/refresh-property-sale-history.ts after the daily sync.

-- ── Recreate the property_hash index on raw_vow_sold ─────────────────────────────
-- Dropped in migration 010 when it had ZERO scans. It now has a real consumer:
-- scripts/worker/sync.ts fetchSoldCampaigns() does `.in('property_hash', chunk)` on
-- raw_vow_sold to stitch prior sold campaigns into True DOM. A single btree on a
-- varchar(64) is a cheap write-side cost (NOT the 175 MB GIN that caused the 010
-- incident) and turns those lookups from a 217k-row seq scan into an index probe.
CREATE INDEX IF NOT EXISTS idx_vow_sold_hash ON raw_vow_sold (property_hash);

-- ── property_sale_history ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_sale_history (
  property_hash     VARCHAR(64) PRIMARY KEY,

  -- Newest-first array of prior sale campaigns:
  --   [{ listing_key, list_price, close_price, contract_date, close_date, sub_type }]
  sale_events       JSONB DEFAULT '[]'::jsonb,

  sale_count        INTEGER DEFAULT 0,        -- number of events in sale_events
  last_close_price  NUMERIC,                  -- close_price of the most recent sale
  last_close_date   DATE,                     -- close/contract date of the most recent sale
  first_seen_date   DATE,                     -- earliest sale date on record

  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE property_sale_history IS
  'Precomputed prior-sale ledger (one row per property_hash) for the listing-page Sale History + Price Timeline. Refreshed nightly from raw_vow_sold; raw_vow_sold itself is never modified.';

-- Reuse the shared trigger fn from migration 007 (CREATE OR REPLACE there).
DROP TRIGGER IF EXISTS update_property_sale_history_updated_at ON property_sale_history;
CREATE TRIGGER update_property_sale_history_updated_at
  BEFORE UPDATE ON property_sale_history
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
