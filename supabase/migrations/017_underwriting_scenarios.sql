-- Migration 017: Saveable underwriting scenarios (P6 — Underwriting Sandbox)
-- Purpose: Persist a signed-in user's named what-if underwrites per listing so the
-- effort they put into modelling a deal follows them across devices (the retention
-- "Investment" hook). Anonymous users keep their scenarios in localStorage; this
-- table only holds data for users who sign in.
--
-- Mirrors the watchlist dual-path: owner-only RLS via auth.uid(); the API route
-- uses the cookie session (RLS-scoped), never the service role.
--
-- NEW TABLE ONLY. Does NOT touch raw_vow_sold / listings / sync_state (CLAUDE.md §12).
--
-- Apply manually (no supabase CLI linked): paste into the Supabase SQL editor, or
--   psql "$DATABASE_URL" -f supabase/migrations/017_underwriting_scenarios.sql
-- (see the supabase-migration-connectivity memory: the direct host is IPv6-only;
--  use the SQL editor or the Session pooler string.)

-- ── underwriting_scenarios ───────────────────────────────────────────────────
-- One row per (user, listing, scenario name). `assumptions` is the full
-- UnderwritingAssumptions blob the engine reads back verbatim.
CREATE TABLE IF NOT EXISTS public.underwriting_scenarios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  listing_key TEXT NOT NULL,            -- MLS ListingKey == /properties/{id}
  name        TEXT NOT NULL,            -- user label, e.g. "20% down @ 5.5%"
  assumptions JSONB NOT NULL,           -- full UnderwritingAssumptions
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, listing_key, name)
);

CREATE INDEX IF NOT EXISTS idx_uw_scenarios_user_listing
  ON public.underwriting_scenarios (user_id, listing_key);

ALTER TABLE public.underwriting_scenarios ENABLE ROW LEVEL SECURITY;

-- A user can only see / add / change / remove their own scenarios.
CREATE POLICY "uw_scenarios_select_own" ON public.underwriting_scenarios
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "uw_scenarios_insert_own" ON public.underwriting_scenarios
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "uw_scenarios_update_own" ON public.underwriting_scenarios
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "uw_scenarios_delete_own" ON public.underwriting_scenarios
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.underwriting_scenarios TO authenticated;

COMMENT ON TABLE public.underwriting_scenarios IS
  'User-owned saved underwriting what-if scenarios per listing (P6). RLS: owner-only via auth.uid().';
