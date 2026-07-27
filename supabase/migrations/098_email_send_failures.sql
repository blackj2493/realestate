-- 098 — email_send_failures: make a broken email pipeline VISIBLE.
--
-- WHY: the welcome email silently failed for weeks (2026-07). The Vercel RESEND_API_KEY
-- value was wrong, so every send from the web app failed — but NOTHING recorded it:
--   • `if (!process.env.RESEND_API_KEY) return;` returns silently when the key is absent;
--   • more insidiously, resend.emails.send() does NOT throw on an API error (a bad-key 401
--     comes back in the returned `{error}`, not as an exception) — and no call-site checked
--     that field, so a wrong key produced no throw, no log, no signal at all.
--
-- This table is the durable record of a failed/blocked transactional send. The shared
-- sendTransactionalEmail() wrapper writes a row on every miss; the nightly data-health
-- canary (which sends from GitHub Actions — a DIFFERENT, working channel, so it still
-- alerts even when Vercel's Resend credential is dead) errors when recent rows exist.
--
-- Deliberately PII-light: recipient stored as DOMAIN only ('gmail.com'), never the address.

CREATE TABLE IF NOT EXISTS email_send_failures (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  -- Which email: 'welcome', 'lead-follow-up', 'confirmation:listing-alerts', etc.
  kind             text NOT NULL,
  -- 'missing_key' | a truncated Resend/API error message.
  reason           text NOT NULL,
  -- Recipient domain only (no full address) — enough to diagnose, no lead PII.
  recipient_domain text
);

-- The canary's only read: "failures in the last N hours".
CREATE INDEX IF NOT EXISTS idx_email_send_failures_occurred
  ON email_send_failures (occurred_at DESC);

COMMENT ON TABLE email_send_failures IS
  'Durable record of failed/blocked transactional email sends, written by sendTransactionalEmail(). Read by the data-health canary so a dead Resend key/credential is caught within a day instead of going silent (cf. the 2026-07 welcome-email incident). Pruned to ~90 days by the canary.';
