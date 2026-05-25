-- Migration 016: Listing view tracking (honest social proof)
-- Purpose: record UNIQUE viewers per listing so the detail page + modal can show a
-- real "N investors viewed this" counter. One row per (listing_key, viewer_id);
-- a refresh just bumps updated_at, so counts are deduped and never inflated.
--
-- Written/read ONLY via the service-role client from the view API route. RLS is
-- ENABLED with NO policies, so anon/authenticated clients cannot touch it directly
-- (only the service-role key, which bypasses RLS, can). viewer_id is a random,
-- client-generated id — not PII.
--
-- NEW TABLE ONLY. Does NOT touch raw_vow_sold / listings / sync_state (CLAUDE.md §12).
--
-- Apply manually (no supabase CLI linked):
--   npx tsx scripts/admin/applyMigration016.ts
--   -- or paste into the Supabase SQL editor / psql -f this file

CREATE TABLE IF NOT EXISTS public.listing_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_key TEXT NOT NULL,             -- MLS ListingKey == /properties/{id}
  viewer_id   TEXT NOT NULL,             -- anonymous, random client id (not PII)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_key, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_views_listing_key ON public.listing_views (listing_key);

ALTER TABLE public.listing_views ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: only the service-role key may read/write this table.

COMMENT ON TABLE public.listing_views IS
  'Unique viewers per listing for on-page social proof. One row per (listing_key, viewer_id), deduped. Service-role only (RLS enabled, no policies).';
