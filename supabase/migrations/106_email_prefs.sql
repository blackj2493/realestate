-- Migration 106: email_prefs — granular, per-user email preferences so a user can
-- control WHICH streams they get and HOW OFTEN, short of a full unsubscribe.
--
-- WHY (engagement build plan 2026-08, item 4.1): today the only lever is
-- profiles.marketing_opt_out (076) — an all-or-nothing one-click unsubscribe. Before we
-- scale marketing volume (the weekly Data Drop, the monthly home report) the Gmail/Yahoo
-- 2024 bulk rules and plain courtesy require a real preference center: turn off just the
-- weekly digest, keep transactional alerts; reduce cadence; "pause 30 days." This table
-- is the store the preference center writes and the send workers read.
--
-- RELATIONSHIP TO marketing_opt_out: that stays the MASTER kill switch (the RFC 8058
-- one-click List-Unsubscribe target). A send is allowed only when the user is NOT
-- master-opted-out AND the specific stream here is on AND no active pause covers now.
-- Absence of a row = all streams on at standard cadence (opt-out model), so existing
-- users need no backfill.
--
-- WHY NOT dashboard_prefs (096): that table is dashboard UI state, owner-only, and the
-- service-role send worker/unsubscribe route must read send-prefs at send time. Email
-- prefs belong next to marketing_opt_out (the profiles/email-sending domain), so they
-- get their own table keyed by user_id. Owner-only RLS lets the preference-center UI
-- (an RLS user client) read/write the user's own row; the service role bypasses RLS to
-- read every row at send time.
--
-- NEW TABLE ONLY — does not touch raw_vow_sold/listings (CLAUDE.md §12).
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 106_email_prefs.sql

CREATE TABLE IF NOT EXISTS public.email_prefs (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Per-stream on/off. Defaults on (opt-out model); missing row = all on.
  onboarding BOOLEAN NOT NULL DEFAULT TRUE,   -- the signup drip (WS1)
  alerts     BOOLEAN NOT NULL DEFAULT TRUE,   -- watchlist / saved-area digest (existing)
  data_drop  BOOLEAN NOT NULL DEFAULT TRUE,   -- weekly market digest (WS2, Phase 1)
  home_value BOOLEAN NOT NULL DEFAULT TRUE,   -- "your home's value moved" + monthly report (WS3)
  product    BOOLEAN NOT NULL DEFAULT TRUE,   -- product / feature announcements

  -- Global cadence lever, applied on top of per-stream toggles by the frequency cap
  -- (WS4.2): 'standard' = normal, 'reduced' = roll non-urgent mail into a weekly max,
  -- 'minimal' = essential/triggered only.
  cadence TEXT NOT NULL DEFAULT 'standard'
    CHECK (cadence IN ('standard', 'reduced', 'minimal')),

  -- "Pause 30 days": while pause_until is in the future, suppress all non-transactional
  -- mail (transactional/OTP is never governed by this table).
  pause_until TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.email_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_prefs_select_own" ON public.email_prefs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "email_prefs_insert_own" ON public.email_prefs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "email_prefs_update_own" ON public.email_prefs
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "email_prefs_delete_own" ON public.email_prefs
  FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE public.email_prefs IS
  'Granular per-user email preferences (per-stream toggles, cadence, pause). Sits beside profiles.marketing_opt_out, which stays the master one-click unsubscribe. Missing row = all streams on at standard cadence. RLS owner-only; service role reads at send time.';
