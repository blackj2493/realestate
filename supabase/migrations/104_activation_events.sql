-- Migration 104: activation_events — a durable, server-side log of the milestone
-- actions that mark a signed-up user "activating" (watch an address, save an area,
-- save a listing, enable an alert, set a persona/prefs, accept VOW terms, apply).
--
-- WHY (engagement build plan 2026-08, item 0.3): product analytics today is PostHog,
-- which is CLIENT-side only (src/lib/analytics/posthog.ts) — it can be blocked, dropped,
-- or simply never wired for these actions, and it can't be read by a server worker.
-- The onboarding drip (WS1) and the cohort-retention dashboard (WS6) both need a
-- *verifiable* record of what a user has actually done. This table is that record:
-- one append-only row per milestone action, written at the server-side write point of
-- each action (the API route / server action that already performs it).
--
-- Append-only by design (multiple 'watch_address' rows for one user is fine); funnel
-- queries DISTINCT/aggregate. Milestone *state* for the drip lives in 105
-- (user_email_lifecycle); this is the raw event stream that feeds it and the funnels.
--
-- NEW TABLE ONLY — does not touch raw_vow_sold/listings (CLAUDE.md §12).
-- RLS enabled with NO policies = service-role only (same pattern as 091/051/014).
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 104_activation_events.sql

CREATE TABLE IF NOT EXISTS public.activation_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Signed-in actions carry user_id; anonymous email-keyed actions (address-watch,
  -- listing-alert lead, /apply) carry only email. At least one is present.
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  -- 'watch_address' | 'save_area' | 'save_listing' | 'enable_alert'
  --   | 'set_persona' | 'set_prefs' | 'accept_vow_terms' | 'apply'
  kind TEXT NOT NULL,
  -- Small free-form context (e.g. { city, address_key, area_type, persona }). No PII
  -- beyond what the action itself is about.
  context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Funnel-by-user ("has this user ever done X?") and cohort queries.
CREATE INDEX IF NOT EXISTS activation_events_user_kind
  ON public.activation_events (user_id, kind);
-- Email-keyed lookups for the anonymous / pre-account actions.
CREATE INDEX IF NOT EXISTS activation_events_email_kind
  ON public.activation_events (lower(email), kind);
-- Recency scans (funnel windows, retention curves).
CREATE INDEX IF NOT EXISTS activation_events_occurred
  ON public.activation_events (occurred_at DESC);

ALTER TABLE public.activation_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.activation_events IS
  'Append-only server-side log of user activation milestones (watch/save/alert/persona/prefs/terms/apply). Feeds the onboarding drip (user_email_lifecycle) and cohort-retention funnels. Service-role only; user_id for signed-in actions, email for anonymous ones.';
