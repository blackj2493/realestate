-- supabase/migrations/050_zoning_areas.sql
--
-- Municipal zoning polygons for the map overlay (Surface B). Reuses the geo_features
-- PostGIS table (migration 037) with kind='zoning'; each feature's attrs carry
-- { code, desc, source, zn_string, gen_zone, frontage, area, units }. Harvested by
-- scripts/admin/harvest-*-zoning.mjs, loaded by scripts/admin/load-zoning.ts.
--
-- Same shape as school_catchments (038): ONE GIST-indexed bbox query per viewport via
-- zoning_in_bbox(), with server-side ST_SimplifyPreserveTopology by zoom so payloads stay
-- small. Replaces the previous in-memory 50 MB CKAN load in /api/zoning (which held the
-- whole city in each serverless instance's heap). Zoning is municipal OPEN DATA (OGL etc.);
-- the UI shows per-source attribution + an "approximate — not a legal survey" disclaimer
-- (src/lib/zoning/attribution.ts).
--
-- Run: npx tsx scripts/admin/applyMigration050.ts

CREATE EXTENSION IF NOT EXISTS postgis;

-- Partial GIST so the overlay's `geom && envelope` only scans zoning rows.
CREATE INDEX IF NOT EXISTS geo_features_zoning_gix
  ON geo_features USING GIST (geom)
  WHERE kind = 'zoning';

-- Viewport query for the overlay. Returns simplified GeoJSON polygons whose geom
-- intersects the envelope. tol>0 simplifies the geometry (coarser when zoomed out).
CREATE OR REPLACE FUNCTION zoning_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  tol     double precision DEFAULT 0
)
RETURNS TABLE (
  code        text,
  description text,
  source      text,
  geometry    json
)
LANGUAGE sql STABLE
AS $$
  SELECT
    attrs->>'code',
    attrs->>'desc',
    attrs->>'source',
    ST_AsGeoJSON(
      CASE WHEN tol > 0 THEN ST_SimplifyPreserveTopology(geom, tol) ELSE geom END
    )::json
  FROM geo_features
  WHERE kind = 'zoning'
    AND geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326);
$$;

GRANT EXECUTE ON FUNCTION zoning_in_bbox(
  double precision, double precision, double precision, double precision, double precision
) TO anon, authenticated, service_role;
