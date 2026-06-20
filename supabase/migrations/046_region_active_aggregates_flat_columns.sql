-- Migration 046: region_active_aggregates reads the flat dimension columns (no detoast).
--
-- Step 3 of the perf fix (045 = add columns, backfill = populate, 046 = this swap). The
-- function body is migration 043's verbatim EXCEPT the beds/baths/parking/frontage/basement
-- predicates now read the flat columns added in 045, with a COALESCE fallback to full_payload
-- for any row whose flat column is still NULL (i.e. not yet backfilled). COALESCE does not
-- evaluate its 2nd arg once the 1st is non-NULL, so a backfilled row NEVER touches
-- full_payload → no TOAST detoast → the ~17s Toronto query drops to sub-second. While the
-- backfill runs, NULL-flat rows transparently fall back (slower, but correct), so results are
-- right throughout. Preserves: 042 Toronto district roll-up, 031 cap_rate_est band, 043 basement.
--
-- BASEMENT SEMANTICS: the flat path uses basement_tier bands (1-5 finished / 6-8 unfinished),
-- identical to the SOLD side (region_price_trend), so the comparison band's active and sold
-- medians now share one basement definition. This is a deliberate, slight tightening vs 043's
-- BasementType-array containment at the tier-8 edge (crawl/half/partial now count as
-- unfinished, which is correct); the full_payload fallback keeps the old array semantics for
-- the brief not-yet-backfilled window.
--
-- Signature is UNCHANGED (7 args) so CREATE OR REPLACE needs no DROP. NOTE: CREATE OR REPLACE
-- RESETS a function's config, so the statement_timeout from migration 044 is re-declared here
-- (kept as insurance; the query is sub-second once backfilled).
--
-- Run: npx tsx scripts/admin/applyMigration046.ts   (or paste into the SQL editor)

CREATE OR REPLACE FUNCTION region_active_aggregates(
  p_region      text,
  p_subtypes    text[]  DEFAULT NULL,
  p_min_beds    integer DEFAULT 0,
  p_min_baths   numeric DEFAULT 0,
  p_min_parking integer DEFAULT 0,
  p_min_frontage numeric DEFAULT 0,
  p_basement    text    DEFAULT 'any'
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
SET statement_timeout = '60s'
AS $$
  WITH active AS (
    SELECT cap_rate_est AS cap, is_stale
    FROM listings
    WHERE (
        lower(city) = lower(p_region)
        OR lower(city_region) = lower(p_region)
        -- Toronto district-code roll-up (migration 042). Index-usable range + strict recheck.
        OR (
          lower(city) >= lower(p_region) || ' '
          AND lower(city) <  lower(p_region) || chr(33)
          AND lower(city) ~ ('^' || lower(p_region) || ' [cwe][0-9][0-9]$')
        )
      )
      AND list_price >= 50000
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      -- Beds/baths/parking/frontage floors — flat columns (migration 045) with a
      -- full_payload fallback ONLY when the flat value is NULL (not yet backfilled).
      -- COALESCE skips its 2nd arg when the 1st is non-NULL, so backfilled rows never detoast.
      AND (p_min_beds     <= 0 OR COALESCE(bedrooms_total,          NULLIF(full_payload->>'BedroomsTotal', '')::numeric)         >= p_min_beds)
      AND (p_min_baths    <= 0 OR COALESCE(bathrooms_total_integer, NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric) >= p_min_baths)
      AND (p_min_parking  <= 0 OR COALESCE(parking_total,           NULLIF(full_payload->>'ParkingTotal', '')::numeric)          >= p_min_parking)
      AND (p_min_frontage <= 0 OR COALESCE(lot_width,               NULLIF(full_payload->>'LotWidth', '')::numeric)              >= p_min_frontage)
      -- Basement finish (migration 046). Flat basement_tier bands (mirrors the sold side);
      -- fall back to 043's BasementType-array containment only when basement_tier IS NULL.
      AND (
        p_basement = 'any'
        OR (basement_tier IS NOT NULL AND (
              (p_basement = 'finished'   AND basement_tier BETWEEN 1 AND 5)
           OR (p_basement = 'unfinished' AND basement_tier BETWEEN 6 AND 8)))
        OR (basement_tier IS NULL AND (
              (p_basement = 'finished'
                 AND full_payload->'Basement' ?| array['Finished', 'Apartment', 'Finished with Walk-Out', 'Partially Finished'])
           OR (p_basement = 'unfinished'
                 AND full_payload->'Basement' ? 'Unfinished')))
      )
      AND lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', ''))
          NOT IN ('sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended')
  )
  SELECT
    count(*)::int AS active_count,
    count(*) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::int AS cap_sample,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY cap)
          FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15)::numeric, 2) AS median_cap_rate,
    round(avg(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2) AS avg_cap_rate,
    round(max(cap) FILTER (WHERE cap IS NOT NULL AND cap >= 1 AND cap <= 15), 2) AS top_cap_rate,
    count(*) FILTER (WHERE is_stale)::int AS stale_count
  FROM active;
$$;

COMMENT ON FUNCTION region_active_aggregates(text, text[], integer, numeric, integer, numeric, text) IS
  'Full-population active-inventory aggregates for one market area (Toronto district roll-up, migration 042). Floors read flat dimension columns (migration 045/046) with a full_payload fallback for un-backfilled rows; basement uses basement_tier bands (matches the sold side). Returns scalars only — no listing rows (§6.3b).';
