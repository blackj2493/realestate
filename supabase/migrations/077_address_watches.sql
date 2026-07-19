-- 077: address_watches — "Track this address" email-only lead capture from the
-- address-profile page (ADDRESS_PROFILES_PLAN P2). Mirrors listing_alerts (051): RLS
-- enabled with NO policies = service-role only; the API route is the sole writer.
-- Delivery (matching new listings to watches in the nightly worker) is a follow-up;
-- last_notified_at is reserved for it.

CREATE TABLE IF NOT EXISTS address_watches (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  -- slugify(address + city) — the dedupe identity for an address independent of formatting.
  address_key TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT,
  postal TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  -- active | unsubscribed
  status TEXT NOT NULL DEFAULT 'active',
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS address_watches_email_address
  ON address_watches (email, address_key);

CREATE INDEX IF NOT EXISTS address_watches_status
  ON address_watches (status)
  WHERE status = 'active';

ALTER TABLE address_watches ENABLE ROW LEVEL SECURITY;
