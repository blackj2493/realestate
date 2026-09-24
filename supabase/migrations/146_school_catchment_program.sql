-- supabase/migrations/146_school_catchment_program.sql
--
-- School catchments gain a PROGRAM axis beside the existing PANEL axis.
--
-- Migration 038 filtered the overlay with `attrs->>'panel' = p_panel OR panel = 'combined'`,
-- and the UI only ever sends 'elementary' or 'secondary'. Boards that publish a program
-- boundary were loaded under a panel value invented for the program — DPCDSB 'french' (17
-- rows), DCDSB 'french_immersion' (3) and DCDSB 'regular' (11) — so 31 rows sat in
-- geo_features that no viewport query could ever return. A reader reported the visible
-- symptom: St Cyril's French Immersion zone is 57.6 km2 (the dissolved union of its 11
-- feeder zones), against the 19.6 km2 proximity circle the map drew in its place.
--
-- After this migration:
--   panel   = elementary | secondary | combined        (grade range)
--   program = regular | french_immersion | extended_french   (stream)
-- Both are independent. A program zone overlaps the regular zones it draws from and is
-- usually several times larger, so the map must filter on both or it stacks unrelated
-- boundaries on top of each other.
--
-- p_program defaults to 'regular' so an un-upgraded caller keeps today's behaviour
-- (home catchments only) instead of suddenly drawing every program zone as well.
-- Rows written before scripts/admin/load-school-catchments.ts set the key are read as
-- 'regular' via COALESCE, so the overlay works before and after the reload.
--
-- Run: npx tsx scripts/admin/applyMigration.ts 146   (or the pooler, CLAUDE.md §12)

-- Panel and program are both read on every overlay query; index the pair so the filter
-- stays on the partial GIST's result set rather than re-reading attrs per row.
CREATE INDEX IF NOT EXISTS geo_features_school_panel_program_idx
  ON geo_features ((attrs->>'panel'), (COALESCE(attrs->>'program', 'regular')))
  WHERE kind = 'school_catchment';

-- ── viewport overlay ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION school_catchments_in_bbox(
  min_lng   double precision,
  min_lat   double precision,
  max_lng   double precision,
  max_lat   double precision,
  p_panel   text DEFAULT NULL,
  p_system  text DEFAULT NULL,
  tol       double precision DEFAULT 0,
  p_program text DEFAULT 'regular'
)
RETURNS TABLE (
  school_name text,
  panel       text,
  program     text,
  grades      text,
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
    COALESCE(attrs->>'program', 'regular'),
    attrs->>'grades',
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
    AND (p_panel   IS NULL OR attrs->>'panel' = p_panel OR attrs->>'panel' = 'combined')
    AND (p_system  IS NULL OR attrs->>'system' = p_system)
    AND (p_program IS NULL OR COALESCE(attrs->>'program', 'regular') = p_program);
$$;

-- ── one school's zones, for the "near a specific school" focus ───────────────────
-- Returns every zone held for that school. A school that runs French Immersion has a
-- regular zone AND a much larger FI zone under the same school_id; the caller filters
-- by program and labels each one, so an FI zone is never captioned "home catchment".
CREATE OR REPLACE FUNCTION school_catchment_by_id(
  p_school_id text,
  tol         double precision DEFAULT 0,
  p_program   text DEFAULT NULL
)
RETURNS TABLE (
  school_name text,
  panel       text,
  program     text,
  grades      text,
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
    COALESCE(attrs->>'program', 'regular'),
    attrs->>'grades',
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
    AND attrs->>'school_id' = p_school_id
    AND (p_program IS NULL OR COALESCE(attrs->>'program', 'regular') = p_program);
$$;

GRANT EXECUTE ON FUNCTION school_catchments_in_bbox(
  double precision, double precision, double precision, double precision, text, text, double precision, text
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION school_catchment_by_id(text, double precision, text)
  TO anon, authenticated, service_role;

-- The 7-arg and 2-arg signatures from migrations 038/039 would still resolve and would
-- silently return the pre-program shape, so PostgREST could pick the wrong one. Drop them.
DROP FUNCTION IF EXISTS school_catchments_in_bbox(
  double precision, double precision, double precision, double precision, text, text, double precision
);
DROP FUNCTION IF EXISTS school_catchment_by_id(text, double precision);
