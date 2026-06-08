-- Migration 032: property_campaign_history
-- Per-property campaign ledger (one row per property_hash) powering the corrected
-- True DOM and the HouseSigma-parity event timeline. Reconstructed from the VOW feed
-- by address (scripts + getListingDetail, Phases 2-3); SEPARATE from the sold-only
-- property_sale_history (which stays for AVM/comps). See
-- docs/superpowers/specs/2026-06-08-true-dom-campaign-history-design.md.

CREATE TABLE IF NOT EXISTS property_campaign_history (
  property_hash      VARCHAR(64) PRIMARY KEY,
  -- newest-first array of CampaignEvent (see src/lib/campaignHistory/types.ts):
  --   { listing_key, transaction_type, status, entry_date, end_date, end_reason,
  --     list_price, original_list_price, close_price, brokerage, price_change_date, address }
  events             JSONB DEFAULT '[]'::jsonb,
  true_dom           INTEGER,        -- current continuous SALE campaign (35-day stitch)
  total_price_drop   NUMERIC,        -- over that current stitched campaign (>=0)
  campaign_count     INTEGER DEFAULT 0,
  first_seen_date    DATE,
  is_stale           BOOLEAN DEFAULT FALSE,
  fetched_at         TIMESTAMPTZ,    -- TTL / freshness anchor (24h)
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE property_campaign_history IS
  'Per-property campaign ledger (one row per property_hash) for corrected True DOM + event timeline. Reconstructed from the VOW feed by address; refreshed nightly for active listings.';

-- Reuse the shared updated_at trigger fn (defined in migration 007).
DROP TRIGGER IF EXISTS update_property_campaign_history_updated_at ON property_campaign_history;
CREATE TRIGGER update_property_campaign_history_updated_at
  BEFORE UPDATE ON property_campaign_history
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
