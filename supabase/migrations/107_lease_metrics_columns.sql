-- Migration 107: rental-native LEASE-track columns (lease_true_dom, lease_total_price_drop).
--
-- The "For Rent" dashboard boards need real lease metrics — rental days-on-market and
-- rent reductions — instead of the SALE-derived TrueDom/TotalPriceDrop that leak onto a
-- rental listing (a sale→lease flip showed its old six-figure sale drop on a $3k rental).
-- computeTrueDomFromCampaigns now stitches the LEASE campaigns separately and produces
-- these twins; this migration is where they persist.
--
-- DELIBERATELY SEPARATE from the sale columns. No region RPC / analytics function reads
-- these — the five live region RPCs (migration 106) read raw_vow_sold with
-- transaction_type='For Sale' — so the sale surfaces are provably untouched. Sale
-- listings carry 0.
--
--   * property_campaign_history: the stitched ledger values (mirrors true_dom/total_price_drop).
--   * listings: flat mirror written by sync.ts; reindex-from-vault reads full_payload, but the
--     flat columns keep symmetry with the sale side and are available for any future RPC.
--
-- ADD COLUMN with a default is instant (Postgres 11+ stores the default in the catalog).
-- Apply BEFORE deploying the code that SELECTs these columns (store.readCampaignHistory)
-- and before the nightly sync writes them. Record in schema_migrations.
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 107_lease_metrics_columns.sql

ALTER TABLE property_campaign_history
  ADD COLUMN IF NOT EXISTS lease_true_dom         INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_total_price_drop NUMERIC DEFAULT 0;

COMMENT ON COLUMN property_campaign_history.lease_true_dom IS
  'LEASE-track True DOM: rental days-on-market over the current stitched LEASE campaign (migration 107). Twin of true_dom (which stays SALE-only). 0 when the property has no lease campaign.';
COMMENT ON COLUMN property_campaign_history.lease_total_price_drop IS
  'LEASE-track rent reduction $ over the current stitched LEASE campaign (migration 107). Twin of total_price_drop (SALE-only). 0 when no lease drop.';

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS lease_true_dom         INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_total_price_drop NUMERIC DEFAULT 0;

COMMENT ON COLUMN listings.lease_true_dom IS
  'Flat LEASE-track rental DOM (migration 107), floored to the current listing''s age for For-Lease rows. Written by sync.ts; backs the "For Rent" boards via LeaseTrueDom in Typesense. 0 for sale listings. No region RPC reads it.';
COMMENT ON COLUMN listings.lease_total_price_drop IS
  'Flat LEASE-track rent reduction $ (migration 107). Written by sync.ts; backs the "Biggest Rent Reductions" board via LeaseTotalPriceDrop in Typesense. 0 for sale listings. No region RPC reads it.';
