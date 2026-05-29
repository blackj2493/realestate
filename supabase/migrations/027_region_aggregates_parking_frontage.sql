-- Migration 027: Parking/frontage filter for the Region Scorecard (CLAUDE.md §3B, §10)
-- Purpose: complete lens parity on the comparison band — after beds/baths (026), let
--          the global lens's parking (minGarage) and lot-frontage (minFrontage)
--          sliders also narrow the full-population ACTIVE-inventory aggregates, so the
--          scorecard medians match the Typesense boards and the sold-side trend on
--          every "what kind of property" dimension except finished-basement (which is
--          empty on historical sold rows, so it is deliberately NOT scoped server-side).
--          Adds two optional params (p_min_parking, p_min_frontage) to the existing RPC.
--
-- This file is INSTANT DDL ONLY (editor-safe): drop the 4-arg overload, recreate with
-- the two extra params. No table writes, no index builds — parking/frontage are read
-- from the already-detoasted full_payload JSONB on the region-narrowed subset (listings
-- has no flat parking/frontage columns — migration 001), the same fields the Typesense
-- boards filter on (ParkingTotal / LotWidth). raw_vow_sold is NOT touched (CLAUDE.md §12);
-- the SOLD side gets parking/frontage via flat columns in the price-trend route.
--
-- p_min_parking / p_min_frontage <= 0 ⇒ no filter (unchanged behaviour) AND the JSONB
-- cast is short-circuited away. A row whose ParkingTotal/LotWidth is JSON null casts to
-- SQL NULL and fails `>=`, i.e. unknown rows are excluded once a floor is set — matching
-- the sold-side `.gte()` (excludes NULL) and Typesense (missing ⇒ 0).
--
-- Run: npx tsx scripts/admin/applyMigration027.ts   (or paste this file into the SQL editor)

-- Drop the 4-arg overload so a 4-arg call doesn't become ambiguous against the new
-- 6-arg signature (whose trailing params default). Mirrors how 026 dropped (text, text[]).
DROP FUNCTION IF EXISTS region_active_aggregates(text, text[], integer, numeric);

-- ── RPC: region_active_aggregates(p_region, p_subtypes, p_min_beds, p_min_baths,
--                                  p_min_parking, p_min_frontage) ──────────────────────
CREATE OR REPLACE FUNCTION region_active_aggregates(
  p_region       text,
  p_subtypes     text[]  DEFAULT NULL,
  p_min_beds     integer DEFAULT 0,
  p_min_baths    numeric DEFAULT 0,
  p_min_parking  integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0
)
RETURNS TABLE (
  active_count    integer,
  cap_sample      integer,
  median_cap_rate numeric,
  avg_cap_rate    numeric,
  top_cap_rate    numeric,
  stale_count     integer
)
LANGUAGE sql
STABLE
AS $$
  WITH active AS (
    SELECT extrapolated_cap_rate AS cap, is_stale
    FROM listings
    WHERE (lower(city) = lower(p_region) OR lower(city_region) = lower(p_region))
      -- For-sale only: lease/rental rows carry a monthly rent (or $/sqft) in list_price,
      -- which is meaningless for yield-on-cost and pins the cap rate at the 20% ceiling.
      AND list_price >= 50000
      -- Property-type filter (exact spelling match; NULL = all types).
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      -- Beds/baths floor (migration 026), read from full_payload (no flat columns).
      AND (p_min_beds     <= 0 OR NULLIF(full_payload->>'BedroomsTotal', '')::numeric         >= p_min_beds)
      AND (p_min_baths    <= 0 OR NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric >= p_min_baths)
      -- Parking/frontage floor (this migration). Same full_payload source + `<= 0`
      -- short-circuit so the default scan never detoasts these fields.
      AND (p_min_parking  <= 0 OR NULLIF(full_payload->>'ParkingTotal', '')::numeric          >= p_min_parking)
      AND (p_min_frontage <= 0 OR NULLIF(full_payload->>'LotWidth', '')::numeric              >= p_min_frontage)
      AND lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', ''))
          NOT IN ('sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended')
  )
  SELECT
    count(*)::int                                              AS active_count,
    count(*) FILTER (WHERE cap IS NOT NULL AND cap > 0)::int   AS cap_sample,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY cap)
          FILTER (WHERE cap IS NOT NULL AND cap > 0)::numeric, 2) AS median_cap_rate,
    round(avg(cap) FILTER (WHERE cap IS NOT NULL AND cap > 0), 2) AS avg_cap_rate,
    round(max(cap) FILTER (WHERE cap IS NOT NULL AND cap > 0), 2) AS top_cap_rate,
    count(*) FILTER (WHERE is_stale)::int                      AS stale_count
  FROM active;
$$;

COMMENT ON FUNCTION region_active_aggregates(text, text[], integer, numeric, integer, numeric) IS
  'Full-population active-inventory aggregates for one market area, optionally narrowed to a set of PropertySubType spellings and beds/baths/parking/frontage floors (Region Scorecard global lens). Returns scalars only — no listing rows — so the 100-listing display cap (§6.3b) does not apply.';
