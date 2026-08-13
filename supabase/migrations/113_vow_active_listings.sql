-- Migration 113: vow_active_listings — ACTIVE listings that arrive on the VOW datafeed
--
-- WHY THIS TABLE EXISTS AT ALL
-- Our active sync (ingester.ts Query A) reads the IDX feed only. Measured against the
-- live feeds on 2026-08-09, the VOW datafeed carries 16,405 Active listings that IDX
-- does not (112,680 vs 96,275) — 9,755 of them For Sale. Those homes are invisible on
-- PureProperty today: W13584216 (86-2945 Thomas St, asking $599,000, on market since
-- Jul 20) is absent from every store we have, while HouseSigma shows it.
--
-- WHY IT IS A SEPARATE TABLE AND NOT A COLUMN ON `listings`
-- The licence attaches to the FEED, not to the listing's status. Per the PROPTX VOW
-- Datafeed Agreement, a 'VOW' is a "secure password-protected internet website" and the
-- Purpose clause permits display of VOW Listing Information "on the Member's VOW …
-- solely for the purpose of use by Consumers". An Active listing delivered over the VOW
-- feed is VOW Listing Information exactly as a sold one is. Mixing these rows into
-- `listings` would put them one forgotten WHERE clause away from the public IDX surface;
-- a separate table makes the gate structural rather than a filter someone must remember.
--
-- RLS ON WITH NO POLICIES: the anon/publishable key cannot read this table at all, only
-- the service role can. Same pattern as 014_terminal_applications / 111_ops_milestones.
-- That is the second structural gate — even a routing mistake cannot leak these rows to
-- an anonymous browser, because the browser's key has no grant.
--
-- NOT an AVM anchor and NOT read by the AVM. Does not touch raw_vow_sold / listings /
-- sync_state schemas (CLAUDE.md §12). New table only.
--
-- Apply: npx tsx scripts/admin/applyMigrationFiles.ts 113_vow_active_listings.sql

CREATE TABLE IF NOT EXISTS public.vow_active_listings (
  listing_key              TEXT PRIMARY KEY,
  -- Same generatePropertyHash() key space as listings + raw_vow_sold, so a VOW active
  -- can be tied to the same physical home as its sold/relist history.
  property_hash            TEXT NOT NULL DEFAULT '',
  full_payload             JSONB NOT NULL,
  media_urls               TEXT[] NOT NULL DEFAULT '{}',

  -- Flat columns for filtering without detoasting full_payload.
  city                     TEXT,
  city_region              TEXT,
  property_sub_type        TEXT,
  transaction_type         TEXT,
  standard_status          TEXT,
  mls_status               TEXT,
  list_price               NUMERIC,
  unparsed_address         TEXT,
  unit_number              TEXT,
  postal_code              TEXT,
  latitude                 DOUBLE PRECISION,
  longitude                DOUBLE PRECISION,

  original_entry_timestamp TIMESTAMPTZ,
  modification_timestamp   TIMESTAMPTZ,
  -- Advanced every time the feed still reports the listing; the reaper removes rows that
  -- stop appearing, so a listing that leaves the market cannot linger as a live one.
  last_seen_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.vow_active_listings ENABLE ROW LEVEL SECURITY;

-- Delta sync walks the feed by ModificationTimestamp; the reaper sweeps by last_seen_at.
CREATE INDEX IF NOT EXISTS idx_vow_active_modification
  ON public.vow_active_listings (modification_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_vow_active_last_seen
  ON public.vow_active_listings (last_seen_at);
-- Tie a VOW active to the same physical home in listings / raw_vow_sold.
CREATE INDEX IF NOT EXISTS idx_vow_active_property_hash
  ON public.vow_active_listings (property_hash);
CREATE INDEX IF NOT EXISTS idx_vow_active_city_type
  ON public.vow_active_listings (city, transaction_type);

COMMENT ON TABLE public.vow_active_listings IS
  'ACTIVE listings delivered on the VOW datafeed but absent from IDX (~16.4k as of '
  '2026-08). VOW Listing Information: displayable ONLY to signed-in consumers who have '
  'accepted the VOW terms, never to anonymous visitors and never to search engines. '
  'RLS on with no policies (service-role only) so the gate is structural, not a filter.';
COMMENT ON COLUMN public.vow_active_listings.property_hash IS
  'generatePropertyHash() — same key space as listings.property_hash and '
  'raw_vow_sold.property_hash, so one physical home resolves across all three.';
COMMENT ON COLUMN public.vow_active_listings.last_seen_at IS
  'Last time the feed still reported this listing. The reaper deletes rows that stop '
  'appearing — without it a withdrawn listing would render as live forever.';
