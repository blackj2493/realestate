-- Migration 074: flat listings.total_price_drop so region_price_cuts skips the detoast.
--
-- region_price_cuts reads full_payload->>'total_price_drop' per active row → per-row detoast
-- → Toronto ~32s (blocks the /analytics prefetch / risks a function timeout). Promote it to a
-- flat column (the relist-stitched drop sync.ts already computes) so the RPC reads it directly.
-- Backfilled by scripts/admin/backfillTotalPriceDrop.ts; sync.ts writes it forward.
--
-- ADD COLUMN nullable = instant. Run: npx tsx scripts/admin/applyMigrationFiles.ts 074_listings_total_price_drop.sql

ALTER TABLE listings ADD COLUMN IF NOT EXISTS total_price_drop numeric;

COMMENT ON COLUMN listings.total_price_drop IS
  'Flat relist-stitched $ drop from the original ask (migration 074) so region_price_cuts avoids a full_payload detoast. 0 when absent (= no known cut, so the NULL batch marker clears cleanly). Written by sync.ts going forward.';
