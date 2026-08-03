-- Migration 105: user_email_lifecycle — the send-bookkeeping table that turns the one
-- welcome email into a gated onboarding drip without ever double-sending.
--
-- WHY (engagement build plan 2026-08, item 1.1): the sequence engine (WS1.2, a daily
-- GHA step) decides "who is due which onboarding email" by reading each user's real
-- milestone state (from profiles / market_bubbles / watchlist / activation_events) and
-- then needs a durable place to record WHICH drip messages it has already sent, so a
-- re-run never sends the same message twice. This is that place — one row per email
-- address, spanning the whole lifecycle:
--   pre-account lead (captured at /apply, terminal_applications) → account created
--   (auth.users / profiles) → VOW unlock (terms_accepted_at) → activation.
-- Keying on email (not user_id) is deliberate: it lets a single row carry the
-- abandoned-signup nudge (WS5.1, pre-account, email-only) AND the post-account drip;
-- user_id is linked in once an account exists.
--
-- Idempotency model mirrors the alerts worker (scripts/worker/alerts.ts): a message is
-- stamped into `sent` ONLY after Resend confirms the send, so a failed send retries on
-- the next run. `last_sent_at` feeds the global frequency cap / collision rules (WS4.2).
--
-- NEW TABLE ONLY — does not touch raw_vow_sold/listings (CLAUDE.md §12).
-- RLS enabled with NO policies = service-role only (the worker owns this table; the
-- in-app activation checklist (WS1.6, later) derives its state from the feature tables,
-- not from here).
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 105_user_email_lifecycle.sql

CREATE TABLE IF NOT EXISTS public.user_email_lifecycle (
  -- Stable identity across pre-account lead → account. Stored lowercased by the worker.
  email TEXT PRIMARY KEY,
  -- Linked once an account exists; SET NULL (not CASCADE) so deleting the auth user
  -- keeps the send/suppression memory and never resurrects a completed drip.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Send bookkeeping / idempotency: { "<message_id>": "<iso sent-at>" }, e.g.
  --   { "onboarding_dashboard": "2026-08-05T13:00:00Z", "unlock_nudge": "..." }.
  -- The worker skips a message whose id is already a key here.
  sent JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Timestamp of the most recent drip send — drives the global frequency cap (WS4.2).
  last_sent_at TIMESTAMPTZ,
  -- When this address first entered the lifecycle (lead capture or account creation).
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Worker joins lifecycle rows back to accounts by user_id.
CREATE INDEX IF NOT EXISTS user_email_lifecycle_user
  ON public.user_email_lifecycle (user_id);
-- Frequency-cap / due-window scans.
CREATE INDEX IF NOT EXISTS user_email_lifecycle_last_sent
  ON public.user_email_lifecycle (last_sent_at);

ALTER TABLE public.user_email_lifecycle ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.user_email_lifecycle IS
  'Per-email onboarding-drip send bookkeeping (idempotency). Spans pre-account lead → account → activation; keyed on lowercased email, user_id linked once an account exists. `sent` maps message-id → send timestamp; stamped only after Resend confirms. Service-role only.';
