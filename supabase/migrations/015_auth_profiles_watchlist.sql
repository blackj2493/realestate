-- Migration 015: Auth profiles + cross-device watchlist
-- Purpose: Back the new Supabase Auth accounts with two user-owned tables so a
-- watchlist (and, later, saved searches/alerts) follows a user across devices.
--
-- The app stays anonymous-first: accounts are OPTIONAL. These tables only hold
-- data for users who sign in. Everything is locked down with Row Level Security
-- keyed on auth.uid() — the service-role ETL bypasses RLS for the nightly alert job.
--
-- NEW TABLES ONLY. Does NOT touch raw_vow_sold / listings / sync_state (CLAUDE.md §12).
--
-- Apply manually (no supabase CLI linked): paste into the Supabase SQL editor, or
--   psql "$DATABASE_URL" -f supabase/migrations/015_auth_profiles_watchlist.sql

-- ── profiles ────────────────────────────────────────────────────────────────
-- One row per auth user. Auto-created on signup by the trigger below. Holds the
-- identity basics plus an optional JSONB blob to sync the dashboard config later.
CREATE TABLE IF NOT EXISTS public.profiles (
  id               UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email            TEXT,
  full_name        TEXT,
  dashboard_config JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- A user can read and edit only their own profile row.
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- ── watchlist ───────────────────────────────────────────────────────────────
-- Saved/followed properties. The snapshot columns (list_price, last_known_status)
-- are the BASELINE the nightly alert job compares fresh data against; last_alert_*
-- columns dedupe so a user isn't emailed the same drop twice.
CREATE TABLE IF NOT EXISTS public.watchlist (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  listing_key        TEXT NOT NULL,           -- MLS ListingKey == /properties/{id}
  address            TEXT,
  city               TEXT,
  thumb              TEXT,
  list_price         NUMERIC,                 -- snapshot at save time (alert baseline)
  last_known_status  TEXT,                    -- e.g. Active / Sold (alert baseline)
  last_alerted_price NUMERIC,                 -- last price we emailed about (dedupe)
  last_alerted_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, listing_key)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user ON public.watchlist (user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_listing_key ON public.watchlist (listing_key);

ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;

-- A user can only see / add / change / remove their own watchlist rows.
CREATE POLICY "watchlist_select_own" ON public.watchlist
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "watchlist_insert_own" ON public.watchlist
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "watchlist_update_own" ON public.watchlist
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "watchlist_delete_own" ON public.watchlist
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist TO authenticated;

-- ── auto-create a profile on signup ──────────────────────────────────────────
-- SECURITY DEFINER + empty search_path (Supabase hardening guidance): runs as the
-- function owner and bypasses RLS so the insert succeeds during signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data ->> 'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON TABLE public.profiles IS
  'One row per Supabase Auth user (auto-created on signup). RLS: owner-only via auth.uid().';
COMMENT ON TABLE public.watchlist IS
  'User-owned saved/followed properties. Snapshot columns are the alert baseline. RLS: owner-only via auth.uid().';
