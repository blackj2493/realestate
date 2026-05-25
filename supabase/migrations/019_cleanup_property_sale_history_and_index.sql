-- Migration 019: cleanup after the True DOM / sale-history feature (migration 018).
-- Both statements are idempotent and safe to re-run / run on a clean DB (no-ops there).
-- Apply in the Supabase SQL editor (or Session pooler) — see memory supabase-migration-connectivity.

-- 1) idx_vow_sold_hash (recreated by migration 018) ended up UNUSED. fetchSoldCampaigns
--    now reads the property_sale_history precompute (PK lookups on a small table), not
--    raw_vow_sold by hash, and refresh-property-sale-history does a keyset (listing_key)
--    scan. Drop it to stop write-amplification on the hot raw_vow_sold upserts (cf.
--    migration 010, which dropped unused indexes for exactly this Disk IO reason).
DROP INDEX IF EXISTS idx_vow_sold_hash;

-- 2) Remove dead rows from the FIRST (pre-fix) refresh run, which keyed
--    property_sale_history by raw_vow_sold's un-hashed address-string property_hash
--    instead of the SHA-256. Canonical keys are exactly 64 lowercase hex
--    (generatePropertyHash output); everything else is an unmatchable orphan (~188k
--    rows). Inert today (reads only ever hit valid 64-hex keys) but ~2x table bloat.
DELETE FROM property_sale_history WHERE property_hash !~ '^[0-9a-f]{64}$';
