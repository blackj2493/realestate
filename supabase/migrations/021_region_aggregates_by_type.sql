-- Migration 021: Property-type filter for the Region Scorecard (CLAUDE.md §3B, §10)
-- Purpose: let the dashboard's global property-type selector (All / Detached / Semi /
--          Town / Condo) narrow the full-population active-inventory aggregates per
--          market area. Adds an optional p_subtypes array param to the existing RPC.
--
-- This file is INSTANT DDL ONLY (editor-safe): drop the single-arg overload, recreate
-- the function with the extra parameter. No table writes, no index builds — the flat
-- listings.property_sub_type column (migration 001) already exists and is ETL-written,
-- so there is nothing to backfill. raw_vow_sold is NOT touched (CLAUDE.md §12).
--
-- Property subtype spellings are matched by EXACT equality (= ANY(...)). TRREB stores
-- verbatim spellings incl. the trailing-space "Semi-Detached " and slashes in
-- "Att/Row/Townhouse"; the variant list is owned by src/lib/dashboard/propertyTypes.ts
-- (variantsForKeys) and passed in verbatim — never re-spelled or trimmed here.
--
-- Run: npx tsx scripts/admin/applyMigration021.ts   (or paste this file into the SQL editor)

-- Drop the old single-arg overload so only the new signature exists (CREATE OR REPLACE
-- would otherwise leave region_active_aggregates(text) and (text, text[]) side by side).
DROP FUNCTION IF EXISTS region_active_aggregates(text);

-- ── RPC: region_active_aggregates(p_region, p_subtypes) ───────────────────────────────
-- Same body as migration 020 plus an optional property-subtype filter. p_subtypes NULL
-- (or omitted) ⇒ all types (unchanged behaviour). Cap-rate stats still exclude NULL/0
-- (unpriced) rows; cap_sample reports how many fed them. Performance relies on the
-- lower(city)/lower(city_region) partial active indexes from backfill020.ts to reach the
-- region's rows; property_sub_type is then a flat equality on that small subset.
CREATE OR REPLACE FUNCTION region_active_aggregates(
  p_region   text,
  p_subtypes text[] DEFAULT NULL
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

COMMENT ON FUNCTION region_active_aggregates(text, text[]) IS
  'Full-population active-inventory aggregates for one market area, optionally narrowed to a set of PropertySubType spellings (Region Scorecard property-type selector). Returns scalars only — no listing rows — so the 100-listing display cap (§6.3b) does not apply.';
