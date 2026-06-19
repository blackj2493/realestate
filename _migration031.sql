ALTER TABLE listings ADD COLUMN IF NOT EXISTS cap_rate_est NUMERIC;

COMMENT ON COLUMN listings.cap_rate_est IS
  'Real IDX-derived cap rate (financialMetrics: IDX-lease asking-rent NOI / IDX list price), persisted for full-population region aggregation. NULL = no rent estimate (~53% of active) or not yet backfilled. Replaces the fabricated extrapolated_cap_rate (retired with the engine, spec §9).';

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
    SELECT cap_rate_est AS cap, is_stale
    FROM listings
    WHERE (lower(city) = lower(p_region) OR lower(city_region) = lower(p_region))
      AND list_price >= 50000
      AND (p_subtypes IS NULL OR property_sub_type = ANY(p_subtypes))
      AND (p_min_beds <= 0 OR NULLIF(full_payload->>'BedroomsTotal', '')::numeric >= p_min_beds)
      AND (p_min_baths <= 0 OR NULLIF(full_payload->>'BathroomsTotalInteger', '')::numeric >= p_min_baths)
      AND (p_min_parking <= 0 OR NULLIF(full_payload->>'ParkingTotal', '')::numeric >= p_min_parking)
      AND (p_min_frontage <= 0 OR NULLIF(full_payload->>'LotWidth', '')::numeric >= p_min_frontage)
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

COMMENT ON FUNCTION region_active_aggregates(text, text[], integer, numeric, integer, numeric) IS
  'Full-population active-inventory aggregates for one market area (Region Scorecard). Cap stats use the REAL IDX-derived cap_rate_est within the [1,15]% sanity band (de-fake spec §6.2). Returns scalars only — no listing rows — so the 100-listing cap (§6.3b) does not apply.';
