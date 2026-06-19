-- supabase/migrations/039_school_catchment_by_id.sql
--
-- Fetch a specific school's catchment polygon(s) by the joined EQAO school_id, for
-- the "near a specific school" focus: when a user picks a known school we show its
-- REAL boundary instead of the approximate 2.5 km proximity circle (which is then
-- only a fallback for schools whose boundary we don't have).
--
-- Run: npx tsx scripts/admin/applyMigration039.ts

CREATE OR REPLACE FUNCTION school_catchment_by_id(
  p_school_id text,
  tol         double precision DEFAULT 0
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
    ST_AsGeoJSON(CASE WHEN tol > 0 THEN ST_SimplifyPreserveTopology(geom, tol) ELSE geom END)::json
  FROM geo_features
  WHERE kind = 'school_catchment'
    AND attrs->>'school_id' = p_school_id;
$$;

GRANT EXECUTE ON FUNCTION school_catchment_by_id(text, double precision)
  TO anon, authenticated, service_role;
