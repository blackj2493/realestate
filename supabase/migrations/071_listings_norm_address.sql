-- Migration 071: flat listings.norm_address for the sell-through active-exclusion.
--
-- region_listing_outcomes over-counted "withdrawn" because it couldn't tell a property
-- that de-listed-and-relisted (still on the market) from one that truly gave up. Excluding
-- currently-active addresses needs the active listing's address, which lives in full_payload
-- (detoast → would re-break Toronto). This flat column (lower(trim(UnparsedAddress)),
-- '' when absent so the backfill terminates) lets the RPC exclude active listings via a
-- flat join. Backfilled by scripts/admin/backfillNormAddress.ts; sync.ts writes it forward.
--
-- ADD COLUMN nullable = instant. Run: npx tsx scripts/admin/applyMigrationFiles.ts 071_listings_norm_address.sql

ALTER TABLE listings ADD COLUMN IF NOT EXISTS norm_address text;

COMMENT ON COLUMN listings.norm_address IS
  'Flat lower(trim(UnparsedAddress)) (migration 071) — used by region_listing_outcomes to exclude currently-active (relisted) addresses from the withdrawal count without a full_payload detoast. Empty string when the listing has no address. Written by sync.ts going forward.';
