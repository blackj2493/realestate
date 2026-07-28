-- 100_drop_duplicate_listing_key_indexes.sql
--
-- DB audit 2026-07-27, step 4a. Two indexes are exact duplicates of a
-- constraint-backed index on the same single column, so every write maintained the
-- key twice for no benefit:
--
--   idx_listings_listing_key      btree (listing_key)  ==  listings_listing_key_key  UNIQUE
--   idx_raw_vow_sold_listing_key  btree (listing_key)  ==  raw_vow_sold_pkey         PRIMARY KEY
--
-- Verified before dropping: neither backs a constraint, there are NO foreign keys on
-- either table, and pg_depend shows no other dependents. Lookups by listing_key are
-- served identically by the unique/PK index that remains (a unique btree can also stop
-- at the first match, so plans do not get worse).
--
-- Frees ~30 MB and removes two index maintenance writes per row change on the two
-- highest-churn tables in the database.
--
-- CONCURRENTLY so no ACCESS EXCLUSIVE lock is taken on live tables. That means these
-- statements CANNOT run inside a transaction block — apply them one at a time
-- (scripts/admin/applyIndexDrops100.ts does this), not via applyMigrationFiles.ts.
--
-- Rollback (each also CONCURRENTLY, outside a transaction):
--   CREATE INDEX CONCURRENTLY idx_listings_listing_key     ON public.listings     USING btree (listing_key);
--   CREATE INDEX CONCURRENTLY idx_raw_vow_sold_listing_key ON public.raw_vow_sold USING btree (listing_key);

DROP INDEX CONCURRENTLY IF EXISTS public.idx_listings_listing_key;

DROP INDEX CONCURRENTLY IF EXISTS public.idx_raw_vow_sold_listing_key;
