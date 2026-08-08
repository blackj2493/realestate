-- Migration 110: Founding seats
-- Purpose: A durable, countable record of the first N accounts to unlock the
-- renovation-upside tool. It backs two promises we make on the page — the live
-- "N/50 seats taken" counter, and each holder's own seat number — and it is the
-- ONLY thing that makes those promises keepable later. Without this table the
-- offer is unhonourable: there is no way to say who the first 50 were.
--
-- Design notes:
--   * `seat` is a BIGSERIAL and IS the counter. It is also the race fix: two people
--     unlocking at the same instant are assigned distinct numbers by the sequence,
--     so nothing ever reads a count before writing one. There is no cap check to
--     lose a race on — seat <= FOUNDING_SEAT_TOTAL is a founding seat, above it is
--     a waitlist row, decided after the fact.
--   * `user_id` is UNIQUE, so a seat costs a verified Supabase OTP. There is no
--     email field to script against, and re-running the tool can't take a second.
--     The lib layer SELECTs before INSERTing so repeat visits don't burn numbers.
--   * Seats are granted as a side effect of the first UNLOCKED hidden-equity result
--     (src/app/api/avm/hidden-equity/route.ts) — there is no claim button.
--
-- NEW TABLE ONLY. Does NOT touch raw_vow_sold / listings / sync_state (CLAUDE.md §12).
-- Security shape copied from 014_terminal_applications: RLS ON with NO policies, so
-- the anon key cannot read holder PII; service-role writes bypass RLS.
--
-- Apply: psql "$DATABASE_URL" -f supabase/migrations/110_founding_seats.sql

CREATE TABLE IF NOT EXISTS public.founding_seats (
  seat        BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  email       TEXT,
  -- Where they were standing when the seat was taken. `source` carries the ?ref=
  -- campaign tag so we can tell the WhatsApp cohort from the rest.
  source      TEXT,
  city        TEXT,
  city_region TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_founding_seats_created_at
  ON public.founding_seats (created_at DESC);

ALTER TABLE public.founding_seats ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.founding_seats IS
  'The first N accounts to unlock the reno tool. seat (BIGSERIAL) is the counter and the '
  'race fix; user_id UNIQUE means a seat costs a verified OTP. RLS on with no policies '
  '(service-role writes only). Granted in /api/avm/hidden-equity, not by a claim button.';
COMMENT ON COLUMN public.founding_seats.seat IS
  'Assigned by the sequence. <= FOUNDING_SEAT_TOTAL is a founding seat; above it is waitlist.';
COMMENT ON COLUMN public.founding_seats.source IS
  'Campaign tag from ?ref= at claim time (e.g. whatsapp). Null for organic.';
