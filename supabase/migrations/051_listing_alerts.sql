-- Migration 051: listing_alerts — low-friction, single-field email capture from the
-- listing page ("Get price-drop & status alerts on this home"). Anonymous on purpose:
-- most organic listing-page traffic is single-listing buyer intent that never signs up,
-- so this converts that slice into a re-engageable lead WITHOUT a full account.
--
-- Written ONLY via the service-role API route (/api/listing-alerts): validated +
-- rate-limited; no anon RLS access. Mirrors 036_viewing_requests. Instant DDL — safe to
-- paste into the Supabase SQL editor.
CREATE TABLE IF NOT EXISTS public.listing_alerts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_key     TEXT NOT NULL,
  email           TEXT NOT NULL,               -- stored lowercased by the API
  address         TEXT,
  city            TEXT,
  kind            TEXT NOT NULL DEFAULT 'price_status',  -- price_status | relist | similar
  status          TEXT NOT NULL DEFAULT 'active',        -- active | unsubscribed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live subscription per (listing, email, kind); the API upserts with ON CONFLICT DO
-- NOTHING so a repeat submit is idempotent (no duplicate alerts, no error to the user).
CREATE UNIQUE INDEX IF NOT EXISTS listing_alerts_unique
  ON public.listing_alerts (listing_key, email, kind);

ALTER TABLE public.listing_alerts ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated get nothing; the service role bypasses RLS.

COMMENT ON TABLE public.listing_alerts IS
  'Listing-page email alert sign-ups (price-drop / status / similar). Inserted by /api/listing-alerts (service role). Instant DDL — safe for the Supabase SQL editor.';
