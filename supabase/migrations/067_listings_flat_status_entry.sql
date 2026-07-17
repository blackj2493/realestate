-- Migration 067: flat standard_status + original_entry_timestamp on listings.
--
-- region_active_aggregates / region_dom_distribution detoast full_payload PER ROW (the
-- status filter + the 060 OriginalEntryTimestamp naive-floor), which times Toronto out
-- (~18.5k active × ~14ms detoast > 60s). Promote both to flat columns so the RPCs read
-- them directly (migration 068 rewrites the RPCs to COALESCE flat → full_payload, so a
-- NULL row still resolves correctly). listings is NOT active-only (~1/3 sold/leased), so
-- the status filter can't just be dropped — hence the flat status column.
--
-- ADD COLUMN nullable = instant, no table rewrite. Backfilled separately (batched, off-peak)
-- by scripts/admin/backfillFlatStatusEntry.ts; sync.ts writes both going forward.
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 067_listings_flat_status_entry.sql

ALTER TABLE listings ADD COLUMN IF NOT EXISTS original_entry_timestamp timestamptz;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS standard_status text;

COMMENT ON COLUMN listings.original_entry_timestamp IS
  'Flat OriginalEntryTimestamp (migration 067) — lets the region RPCs compute the naive-DoM floor without a full_payload detoast. Backfilled from full_payload; written by sync.ts going forward.';
COMMENT ON COLUMN listings.standard_status IS
  'Flat lowercased status = coalesce(Status, MlsStatus, StandardStatus) (migration 067) so the region RPC status filter skips the full_payload detoast. Backfilled from full_payload; written by sync.ts going forward.';
