-- supabase/migrations/038_school_catchments.sql
--
-- School attendance-boundary (catchment) polygons for the map overlay.
-- Reuses the geo_features PostGIS table (migration 037) with kind='school_catchment';
-- each feature's attrs carry { boardCode, board, system, language, panel, year,
-- school_name, school_id, score, source }. Harvested by
-- scripts/admin/harvest-school-catchments.mjs, loaded by
-- scripts/admin/load-school-catchments.ts.
--
-- Unlike the Things-to-Know read path (precomputed listing_geo_flags, no spatial
-- query at request time), a school-zone overlay is inherently viewport-scoped, so it
-- runs ONE GIST-indexed bbox query via school_catchments_in_bbox(). Bounded by the
-- envelope + server-side ST_SimplifyPreserveTopology so payloads stay small.
-- Boundaries are public open data, shown with attribution + a "verify with the board,
-- boundaries change yearly" disclaimer in the UI.
--
-- Run: npx tsx scripts/admin/applyMigration038.ts

CREATE EXTENSION IF NOT EXISTS postgis;

-- Partial GIST so the overlay's `geom && envelope` only scans catchment rows.
CREATE INDEX IF NOT EXISTS geo_features_school_gix
  ON geo_features USING GIST (geom)
  WHERE kind = 'school_catchment';

-- Viewport query for the overlay. Returns simplified GeoJSON polygons whose bbox
-- intersects the envelope, optionally filtered by panel/system. 'combined' zones
-- (boards like Halton that don't split elementary/secondary) always match a panel.
CREATE OR REPLACE FUNCTION school_catchments_in_bbox(
  min_lng  double precision,
  min_lat  double precision,
  max_lng  double precision,
  max_lat  double precision,
  p_panel  text DEFAULT NULL,
  p_system text DEFAULT NULL,
  tol      double precision DEFAULT 0
)
RETURNS TABLE (
  school_name text,
  panel       text,
  "system"    text,
  board       text,
  board_code  text,
  language    text,
  "year"      text,
  school_id   text,
  score       double precision,
  source      text,
  geometry    json
)
LANGUAGE sql STABLE
AS $$
  SELECT
    attrs->>'school_name',
    attrs->>'panel',
    attrs->>'system',
    attrs->>'board',
    attrs->>'boardCode',
    attrs->>'language',
    attrs->>'year',
    attrs->>'school_id',
    NULLIF(attrs->>'score', '')::double precision,
    attrs->>'source',
    ST_AsGeoJSON(
      CASE WHEN tol > 0 THEN ST_SimplifyPreserveTopology(geom, tol) ELSE geom END
    )::json
  FROM geo_features
  WHERE kind = 'school_catchment'
    AND geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    AND (p_panel  IS NULL OR attrs->>'panel' = p_panel OR attrs->>'panel' = 'combined')
    AND (p_system IS NULL OR attrs->>'system' = p_system);
$$;

GRANT EXECUTE ON FUNCTION school_catchments_in_bbox(
  double precision, double precision, double precision, double precision, text, text, double precision
) TO anon, authenticated, service_role;
