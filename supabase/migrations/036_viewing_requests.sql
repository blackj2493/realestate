-- Migration 036: viewing_requests — lead capture from the listing page's
-- "Schedule Viewing" CTA (was a dead button; audit MEDIUM-17). Written ONLY via
-- the service-role API route (validated + rate-limited); no anon RLS access.
CREATE TABLE IF NOT EXISTS public.viewing_requests (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_key     TEXT NOT NULL,
  address         TEXT,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  preferred_time  TEXT,
  message         TEXT,
  status          TEXT NOT NULL DEFAULT 'new',  -- new | contacted | done
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.viewing_requests ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated get nothing; the service role bypasses RLS.

COMMENT ON TABLE public.viewing_requests IS
  'Listing-page viewing/lead requests. Inserted by /api/viewing-requests (service role). Instant DDL — safe for the Supabase SQL editor.';
