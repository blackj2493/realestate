-- 161: lead_events — one row per touch on a lead (call, text, email, showing).
--
-- WHY. viewing_requests holds 24 real leads (Jul–Oct 2026) and every one sat at status
-- `new` until 2026-11-03: nothing recorded a call, a reply, or how long the first reply
-- took. A review of four October threads found the leads were lost on timing (a 14-hour
-- reply to a renter who wanted a showing within the hour; a 3.5-day reply to a buyer) and
-- on missing follow-ups. With one row per touch we can measure time to first contact,
-- see which follow-ups are due today, and test the follow-up schedule step by step.
--
-- Who reads and writes it: service role only (the owner's admin scripts). No browser
-- access. Rows hold the owner's notes about a lead, so RLS stays on with no policy.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.lead_events (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id     bigint      NOT NULL REFERENCES public.viewing_requests (id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  channel     text        NOT NULL
              CHECK (channel IN ('call', 'text', 'email', 'voicemail', 'showing', 'meeting', 'note')),
  direction   text        NOT NULL DEFAULT 'out' CHECK (direction IN ('out', 'in')),
  outcome     text
              CHECK (outcome IN ('no_answer', 'reached', 'replied', 'booked', 'declined', 'not_qualified', 'other')),
  note        text        CHECK (note IS NULL OR length(note) <= 500)
);

CREATE INDEX IF NOT EXISTS lead_events_lead_at_idx ON public.lead_events (lead_id, at);

ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;

-- Data API grants (REQUIRED since 2026-10-30). Service role only.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_events TO service_role;

COMMENT ON TABLE public.lead_events IS
  'One row per touch on a viewing_requests lead (call/text/email/showing), in or out. Written by the owner''s admin scripts (service role). Drives time-to-first-contact and follow-ups-due.';

INSERT INTO schema_migrations (filename, applied_via)
VALUES ('161_lead_events.sql', 'sql-editor')
ON CONFLICT (filename) DO NOTHING;
