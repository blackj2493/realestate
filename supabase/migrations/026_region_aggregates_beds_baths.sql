-- Migration 026: Beds/baths filter for the Region Scorecard (CLAUDE.md §3B, §10)
-- Purpose: let the dashboard's global lens (beds & baths sliders) narrow the
--          full-population ACTIVE-inventory aggregates per market area, so the
--          comparison band shows the SAME property slice the Typesense boards and
--          the sold-side trend already honor (Phase C of the dashboard redesign).
--          Adds two optional params (p_min_beds, p_min_baths) to the existing RPC.
--
-- This file is INSTANT DDL ONLY (editor-safe): drop the 2-arg overload, recreate the
-- function with the extra params. No table writes, no index builds — beds/baths are
-- read from the already-detoasted full_payload JSONB on the region-narrowed subset
-- (listings has no flat bed/bath columns — migration 001), the same fields the
-- Typesense boards filter on (BedroomsTotal / BathroomsTotalInteger), so the active
-- cohort matches. raw_vow_sold is NOT touched (CLAUDE.md §12); the SOLD side gets
-- beds/baths via flat columns in the price-trend route, no DB change there.
--
-- p_min_beds / p_min_baths <= 0 ⇒ no filter (unchanged behaviour) AND the JSONB cast
-- is short-circuited away, so the default all-types/all-beds scan never detoasts
-- full_payload for these fields. A row whose BedroomsTotal is JSON null casts to SQL
-- NULL and fails `>=`, i.e. unknown-beds rows are excluded once a floor is set — this
-- matches both the sold-side `.gte()` (excludes NULL) and Typesense (missing ⇒ 0).
--
-- Run: npx tsx scripts/admin/applyMigration026.ts   (or paste this file into the SQL editor)

-- Drop the 2-arg overload so a 2-arg call doesn't become ambiguous against the new
-- 4-arg signature (whose trailing params default). Mirrors how 021 dropped (text).
DROP FUNCTION IF EXISTS region_active_aggregates(text, text[]);

-- ── RPC: region_active_aggregates(p_region, p_subtypes, p_min_beds, p_min_baths) ──────
CREATE OR REPLACE FUNCTION region_active_aggregates(
  p_region    text,
  p_subtypes  text[]  DEFAULT NULL,
  p_min_beds  integer DEFAULT 0,
  p_min_baths numeric DEFAULT 0
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
      -- Beds/baths filter, read from full_payload (no flat columns on listings). The
      -- `<= 0` short-circuit keeps the default scan from ever touching full_payload here.
      AND (p_min_beds  <= 0 OR NULLIF(full_payload->>'BedroomsTotal', '')::numeric        >= p_min_beds)
      AND (p_min_baths <= 0 OR NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric >= p_min_baths)
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

COMMENT ON FUNCTION region_active_aggregates(text, text[], integer, numeric) IS
  'Full-population active-inventory aggregates for one market area, optionally narrowed to a set of PropertySubType spellings and a beds/baths floor (Region Scorecard global lens). Returns scalars only — no listing rows — so the 100-listing display cap (§6.3b) does not apply.';
