-- Migration 020: Region aggregates for the dashboard Region Scorecard (CLAUDE.md §3B, §10)
-- Purpose: enable TRUTHFUL, full-population active-inventory aggregates per market area
--          (median/avg/top cap rate, % stale, active count) without the Typesense 100-row
--          sampling cap. Aggregates are computed server-side and only scalars are returned.
--
-- This file is INSTANT DDL ONLY (editor-safe): add two nullable columns + the RPC. The
-- heavy work — backfilling the columns and building the indexes (both detoast the whole
-- full_payload JSONB across ~112k rows and blow the SQL-editor gateway timeout) — lives in
-- scripts/admin/backfill020.ts, which runs batched over a direct connection.
--
-- Additive & non-destructive. raw_vow_sold is NOT touched (CLAUDE.md §12).
--
-- Run: npx tsx scripts/admin/applyMigration020.ts   (or paste this file into the SQL editor)
--      then: npx tsx scripts/admin/backfill020.ts    (backfill + indexes)

-- ── New flat columns (metadata-only, instant) ────────────────────────────────────────
-- extrapolated_cap_rate: persisted Node-ETL value (transformer writes it; §4 keeps cap-rate
--   COMPUTATION in Node — SQL here only AGGREGATES the stored value). NULL until backfilled.
-- city_region: denormalized copy of full_payload->>'CityRegion' (a raw field, not a derived
--   metric) so neighbourhood-level region matching is an indexed equality, like `city`.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS extrapolated_cap_rate NUMERIC;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS city_region VARCHAR(100);

COMMENT ON COLUMN listings.extrapolated_cap_rate IS
  'Stabilized yield-on-cost %, computed in the Node ETL (ExtrapolatedCapRateEngine). Persisted for full-population region aggregation. NULL = not yet backfilled / unpriced.';
COMMENT ON COLUMN listings.city_region IS
  'Denormalized full_payload->>CityRegion (community/neighbourhood) for indexed region matching, mirroring listings.city.';

-- ── RPC: region_active_aggregates ────────────────────────────────────────────────────
-- Returns one row of scalars over the ACTIVE listings matching p_region (exact, case-
-- insensitive, on city OR city_region). Cap-rate stats exclude NULL/0 (unpriced / not-yet-
-- backfilled) so they aren't deflated; cap_sample reports how many rows fed them.
-- Performance: relies on the lower(city)/lower(city_region) indexes from backfill020.ts to
-- reach the region's rows before evaluating the JSONB status predicate on that small subset.
CREATE OR REPLACE FUNCTION region_active_aggregates(p_region text)
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
      -- The $50k floor mirrors price-trend's sold-side filter, keeping active_count and
      -- sold velocity apples-to-apples for months-of-supply.
      AND list_price >= 50000
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

COMMENT ON FUNCTION region_active_aggregates(text) IS
  'Full-population active-inventory aggregates for one market area (Region Scorecard). Returns scalars only — no listing rows — so the 100-listing display cap (§6.3b) does not apply.';
