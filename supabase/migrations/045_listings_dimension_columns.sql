-- Migration 045: flat dimension columns on `listings` (kill the full_payload detoast).
--
-- WHY: region_active_aggregates reads beds/baths/parking/frontage/basement out of the
-- heavily-TOASTed listings.full_payload jsonb. After migration 042 rolled Toronto's 35
-- district codes into one "Toronto" market, a FILTERED query detoasts full_payload across
-- ~14k matched rows and takes ~17s (migration 044 raised statement_timeout so it merely
-- 17s-then-caches instead of 500ing — this migration removes the 17s).
--
-- FIX (this migration = step 1 of 3): add flat scalar columns mirroring the values the
-- ETL already extracts for Typesense (transformer.ts). Step 2 = backfill the ~136k existing
-- rows (scripts/admin/backfill-listings-dimensions.ts). Step 3 = migration 046 swaps the RPC
-- to read these columns (with a full_payload COALESCE fallback so results stay correct while
-- the backfill runs). The sold side already works this way (raw_vow_sold has flat columns +
-- basement_tier), which is why region_price_trend was never slow.
--
-- basement_tier mirrors raw_vow_sold exactly (deriveBasementTier, 1-9): 1-5 finished /
-- partially-finished, 6-8 unfinished, 9 none. This UNIFIES the active + sold aggregate
-- basement semantics (both tier-based) so the comparison band is internally coherent.
--
-- SAFETY: every column is NULLABLE with no DEFAULT, so this is an INSTANT catalog-only
-- change — Postgres does NOT rewrite the 136k-row table (a DEFAULT would force a rewrite).
-- No indexes here: the region clause already narrows to a city's rows via the existing
-- city indexes, and the floor predicates then filter that small set on cheap flat columns
-- (the 17s was 100% detoast, not row count). Indexes can be added later if a no-region
-- filter path ever needs them.
--
-- Run: npx tsx scripts/admin/applyMigration045.ts   (or paste into the SQL editor)

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS bedrooms_total           numeric,
  ADD COLUMN IF NOT EXISTS bathrooms_total_integer  numeric,
  ADD COLUMN IF NOT EXISTS parking_total            numeric,
  ADD COLUMN IF NOT EXISTS lot_width                numeric,
  ADD COLUMN IF NOT EXISTS basement_tier            integer;

COMMENT ON COLUMN listings.bedrooms_total          IS 'Flat denorm of full_payload->>BedroomsTotal (migration 045) — region_active_aggregates floor without a TOAST detoast.';
COMMENT ON COLUMN listings.bathrooms_total_integer IS 'Flat denorm of full_payload->>BathroomsTotalInteger (migration 045).';
COMMENT ON COLUMN listings.parking_total           IS 'Flat denorm of full_payload->>ParkingTotal (migration 045).';
COMMENT ON COLUMN listings.lot_width               IS 'Flat denorm of full_payload->>LotWidth (migration 045).';
COMMENT ON COLUMN listings.basement_tier           IS 'deriveBasementTier(full_payload) 1-9 (migration 045) — mirrors raw_vow_sold.basement_tier; 1-5 finished, 6-8 unfinished, 9 none.';
