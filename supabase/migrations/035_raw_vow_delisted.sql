-- supabase/migrations/035_raw_vow_delisted.sql
--
-- Slim 12-month archive of de-listed (Terminated/Expired/Suspended) VOW
-- listings. Deliberately NO raw_payload JSONB â€” the full payload remains
-- fetchable from the feed forever; this table stores only what the De-listed
-- surface and future failure-rate analytics need (design spec 2026-06-09).
-- RLS is enabled with NO policies: service-role-only (VOW data must never be
-- anon-readable).

CREATE TABLE IF NOT EXISTS raw_vow_delisted (
  listing_key            TEXT PRIMARY KEY,
  mls_status             TEXT,
  standard_status        TEXT,
  transaction_type       TEXT,
  -- The de-list event date this row is windowed/sorted on (see delistedMapper
  -- precedence: status-specific date, else ModificationTimestamp date).
  delisted_date          DATE NOT NULL,
  expiration_date        DATE,
  listing_contract_date  DATE,
  list_price             NUMERIC,
  original_list_price    NUMERIC,
  days_on_market         INTEGER,
  unparsed_address       TEXT,
  city                   TEXT,
  city_region            TEXT,
  -- Parsed from the FULL address (parsePostal.ts), not the FSA-only field.
  postal_code            TEXT,
  property_sub_type      TEXT,
  bedrooms_above_grade   INTEGER,
  bathrooms_total_integer NUMERIC,
  parking_total          INTEGER,
  -- Mandatory brokerage display (CLAUDE.md section 4) on every surfaced card.
  list_office_name       TEXT,
  lat                    DOUBLE PRECISION,
  lng                    DOUBLE PRECISION,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_vow_delisted_date
  ON raw_vow_delisted (delisted_date DESC);
CREATE INDEX IF NOT EXISTS idx_raw_vow_delisted_city_date
  ON raw_vow_delisted (city, delisted_date DESC);

ALTER TABLE raw_vow_delisted ENABLE ROW LEVEL SECURITY;

-- Keep updated_at fresh on row updates (shared function from migration 001).
DROP TRIGGER IF EXISTS update_raw_vow_delisted_updated_at ON raw_vow_delisted;
CREATE TRIGGER update_raw_vow_delisted_updated_at
  BEFORE UPDATE ON raw_vow_delisted
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
