-- Migration 033: partial index for fast "active listings by property_hash" enumeration.
--
-- The True DOM warm-pass (scripts/admin/warmCampaignHistory.ts) — and any future
-- enumeration of active listings by property_hash — filters on:
--     lower(coalesce(full_payload->>'StandardStatus','')) = 'active'
-- No existing index covers that expression (the idx_listings_active_*_lower
-- partial indexes use a different "not-in-offmarket" COALESCE predicate and are
-- keyed on lower(city)/lower(city_region)). So Postgres seq-scans and DETOASTS
-- full_payload across every listings row (~136k) to evaluate the filter — the
-- dominant, IO-bound cost (~5 min on this instance; CLAUDE.md §12, supabase-io-budget).
--
-- This partial index bakes the active predicate in at build time (no per-query
-- detoast) and is keyed on property_hash, so the likely-relist join becomes an
-- index scan and the COUNT is index-only. The predicate matches the enumeration
-- EXACTLY so the planner reuses it.
--
-- CONCURRENTLY: `listings` is read by the listing-detail page (getListingDetail);
-- build the index without taking an ACCESS EXCLUSIVE lock. This MUST remain the
-- ONLY statement in this file — CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block / multi-statement simple-query (apply via applyMigration033.ts,
-- which runs it as a single autocommit statement with statement_timeout disabled).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_active_property_hash
  ON listings (property_hash)
  WHERE lower(coalesce(full_payload->>'StandardStatus', '')) = 'active';
