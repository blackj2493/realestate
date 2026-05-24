-- Migration 013: Create shared_collections table
-- Purpose: Backs the "share a selection of properties" feature on the Terminal page.
--          When a user multi-selects listings and hits Share, we persist the chosen
--          ListingKeys here and mint a short token. The public read-only page
--          /share/<token> re-hydrates those listings live (by listing_key) so the
--          recipient sees current, compliant data — we store KEYS only, never a snapshot.
--
-- Anonymous by design: the running app has no auth, so there is no creator user id.
-- Writes/reads go through the service-role client in API routes (RLS bypassed), so no
-- RLS policy is required. New table only — does NOT touch listings or raw_vow_sold.
--
-- Lookups are single-row by token (indexed) — they do not scan and so do not draw on
-- the Supabase Disk IO burst budget.

CREATE TABLE IF NOT EXISTS shared_collections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token        TEXT NOT NULL UNIQUE,        -- short, URL-safe; lives in the share URL
  listing_keys TEXT[] NOT NULL,             -- selected ListingKeys (≤100, enforced in API)
  note         TEXT,                        -- optional message from the sharer (future use)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ                  -- nullable; no expiry in v1, reserved for later
);

CREATE INDEX IF NOT EXISTS shared_collections_token_idx ON shared_collections (token);
