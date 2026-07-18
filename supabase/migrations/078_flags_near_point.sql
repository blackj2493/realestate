-- 078: flags_near_point — live point-radius "Things to Know" lookup for the
-- address-profile page (ADDRESS_PROFILES_PLAN P3). Precedent: zoning_in_bbox (050).
--
-- The listing flow stays on precomputed listing_geo_flags (Disk-IO budget); this RPC
-- serves arbitrary geocoded addresses that have no precomputed row. Callers pass the
-- dataset specs (kind + metres) from the TS registry (GEO_DATASETS) so SQL never
-- duplicates radii. Per-feature attrs->>'_match_radius_m' (a per-source TIGHTER radius,
-- e.g. dense Toronto) overrides the dataset-level metres, mirroring enrichGeoFlags.
-- Intersect-predicate datasets pass meters=0 (ST_DWithin at 0 = containment/touch).
--
-- Uses the functional GIST index on (geom::geography) from migration 037.

CREATE OR REPLACE FUNCTION flags_near_point(
  in_lat double precision,
  in_lng double precision,
  in_specs jsonb
)
RETURNS TABLE (kind text, attrs jsonb, distance_m integer)
LANGUAGE sql
STABLE
AS $$
  SELECT
    f.kind,
    f.attrs,
    CAST(
      ST_Distance(
        f.geom::geography,
        ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography
      ) AS integer
    ) AS distance_m
  FROM geo_features f
  JOIN jsonb_to_recordset(in_specs) AS s(kind text, meters int)
    ON s.kind = f.kind
  WHERE ST_DWithin(
    f.geom::geography,
    ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
    COALESCE((f.attrs->>'_match_radius_m')::numeric, s.meters)
  )
  ORDER BY distance_m ASC
  LIMIT 40;
$$;

-- Service-role only (called via getServiceRoleClient) — no anon/authenticated grants.
REVOKE ALL ON FUNCTION flags_near_point(double precision, double precision, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flags_near_point(double precision, double precision, jsonb) TO service_role;
