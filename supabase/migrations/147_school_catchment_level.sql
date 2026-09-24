-- supabase/migrations/147_school_catchment_level.sql
--
-- School catchments gain a LEVEL axis: the grade band WITHIN a panel.
--
-- TDSB runs two tiers of elementary school. An address is assigned a JK-entry school
-- AND a separate 6-8 middle/senior school whose zone spans several JK-entry zones, so
-- both cover the same ground. Our harvester filed both under the directory's level, so
-- both landed as panel='elementary' and the overlay drew them on top of each other:
-- 155 of 411 sampled Toronto addresses sat inside two of our 'elementary' zones.
--
-- Verified against all 583 TDSB schools on 2026-09-21: no school carries both folders,
-- and all 56 schools with an Intermediate boundary are named Middle/Senior/Sr — so the
-- board's own folder is an exact, non-overlapping split.
--
--   panel   = elementary | secondary | combined          (which school system tier)
--   level   = junior | intermediate | NULL               (grade band inside elementary)
--   program = regular | french_immersion | extended_french
--
-- A row with NO level matches whatever level the caller asks for. That is deliberate:
-- only TDSB publishes this split today, and every other board's zones must keep showing
-- when the overlay asks for 'junior'. The predicate is
-- COALESCE(attrs->>'level', p_level) = p_level, not attrs->>'level' = p_level, which
-- would silently blank 20 boards — the same failure that hid the French zones.
--
-- p_level defaults to NULL (= no filtering) so an un-upgraded caller is unaffected.
--
-- Run: npx tsx scripts/admin/applyMigrationFiles.ts 147_school_catchment_level.sql

CREATE INDEX IF NOT EXISTS geo_features_school_level_idx
  ON geo_features ((attrs->>'level'))
  WHERE kind = 'school_catchment' AND attrs ? 'level';

-- ── viewport overlay ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION school_catchments_in_bbox(
  min_lng   double precision,
  min_lat   double precision,
  max_lng   double precision,
  max_lat   double precision,
  p_panel   text DEFAULT NULL,
  p_system  text DEFAULT NULL,
  tol       double precision DEFAULT 0,
  p_program text DEFAULT 'regular',
  p_level   text DEFAULT NULL
)
RETURNS TABLE (
  school_name text,
  panel       text,
  program     text,
  grades      text,
  "level"     text,
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
    attrs->>'level',
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
    AND (p_program IS NULL OR COALESCE(attrs->>'program', 'regular') = p_program)
    AND (p_level   IS NULL OR COALESCE(attrs->>'level', p_level) = p_level);
$$;

-- ── one school's zones, for the "near a specific school" focus ───────────────────
CREATE OR REPLACE FUNCTION school_catchment_by_id(
  p_school_id text,
  tol         double precision DEFAULT 0,
  p_program   text DEFAULT NULL,
  p_level     text DEFAULT NULL
)
RETURNS TABLE (
  school_name text,
  panel       text,
  program     text,
  grades      text,
  "level"     text,
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
    attrs->>'level',
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
    AND (p_program IS NULL OR COALESCE(attrs->>'program', 'regular') = p_program)
    AND (p_level   IS NULL OR COALESCE(attrs->>'level', p_level) = p_level);
$$;

GRANT EXECUTE ON FUNCTION school_catchments_in_bbox(
  double precision, double precision, double precision, double precision,
  text, text, double precision, text, text
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION school_catchment_by_id(text, double precision, text, text)
  TO anon, authenticated, service_role;

-- Migration 146's signatures would still resolve and would return the pre-level shape,
-- so PostgREST could pick the wrong one. Drop them, as 146 dropped 038/039's.
DROP FUNCTION IF EXISTS school_catchments_in_bbox(
  double precision, double precision, double precision, double precision, text, text, double precision, text
);
DROP FUNCTION IF EXISTS school_catchment_by_id(text, double precision, text);
