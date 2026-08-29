-- 129: reno_lookups — keep the address people type into the renovation-upside funnel.
--
-- WHY. `RenoAddressField` (src/components/reno/RenoAddressField.tsx) prompts with
-- "Start typing your home address…", geocodes the pick into a ResolvedLocation carrying
-- { label, lat, lng, city, cityRegion }, hands it to RenovationFunnel — which keeps
-- cityRegion and coords to choose a cohort and THROWS THE ADDRESS AWAY. Every visitor who
-- has ever used the tool named the home they live in, unprompted, and we kept the
-- neighbourhood.
--
-- That address is the highest-intent signal the product can collect. Nothing else in this
-- schema holds one: `address_watches` (077) took 3 rows in its first 17 days, and
-- `dashboard_prefs.config.regions` is city-grain. Without this table the Personal engine
-- has no audience to send to, whatever shape its email eventually takes.
--
-- PRIVACY POSTURE — read before widening this.
-- A SIGNED-IN visitor's row keeps the street address: they hold an account, we can act on
-- it, and the row deletes with the user. An ANONYMOUS visitor's row keeps only the
-- community, the property type and the timestamp. We could never email an anonymous row
-- anyway, so holding an identifiable home address against no contactable person is a
-- liability that buys nothing. The demand signal — how many people looked up a home in
-- this community — survives intact either way.
--
-- The anonymous case is not merely a convention in the API route; the CHECK below makes it
-- impossible for any future writer to store an address without a user attached. A funnel
-- visitor who signs in mid-flow is captured WITH their address, because the sign-in stash
-- in RenovationFunnel carries the label across the round trip.
--
-- RLS enabled with NO policies = service-role only, mirroring address_watches (077). The
-- API route is the sole writer.

CREATE TABLE IF NOT EXISTS reno_lookups (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- NULL for an anonymous visitor. CASCADE so deleting an account takes the addresses with it.
  user_id           UUID REFERENCES auth.users (id) ON DELETE CASCADE,

  -- Signed-in rows only (see the CHECK). `address` is the geocoded label the visitor
  -- picked, `address_key` is slugify(address + city) — the same dedupe identity
  -- address_watches uses, so the two can be joined without re-parsing either.
  address           TEXT,
  address_key       TEXT,
  lat               DOUBLE PRECISION,
  lng               DOUBLE PRECISION,

  -- Always stored. This is the demand signal, and it is not identifying on its own.
  city              TEXT,
  city_region       TEXT,
  property_sub_type TEXT,

  -- False when the geocoded address did not land in a trained cohort — the funnel still
  -- renders, and the miss is worth counting: it maps where the AVM has no coverage.
  matched           BOOLEAN NOT NULL DEFAULT false,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reno_lookups_anon_carries_no_address CHECK (
    user_id IS NOT NULL
    OR (address IS NULL AND address_key IS NULL AND lat IS NULL AND lng IS NULL)
  )
);

-- "Which addresses do we now hold, newest first" — the query the Personal engine runs to
-- find an audience, and the one the owner runs to decide whether there is one.
CREATE INDEX IF NOT EXISTS reno_lookups_user_created
  ON reno_lookups (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- One row per person per home is what the engine wants; the raw log is what analysis
-- wants. Keep both by indexing rather than constraining — a repeat lookup of the same
-- home is itself a signal, and de-duplication belongs in the read, not the write.
CREATE INDEX IF NOT EXISTS reno_lookups_address_key
  ON reno_lookups (address_key)
  WHERE address_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS reno_lookups_created
  ON reno_lookups (created_at DESC);

ALTER TABLE reno_lookups ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE reno_lookups IS
  'Addresses typed into the renovation-upside funnel. Signed-in rows keep the street address; anonymous rows keep only community/type (CHECK reno_lookups_anon_carries_no_address). Service-role only. Written by /api/reno/lookups. See migration 129 for the full rationale.';
