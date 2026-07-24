-- 094: flags_near_point — make the point-radius lookup use the GIST index.
--
-- WHY: 078's single-stage WHERE used a PER-ROW radius —
--   ST_DWithin(geom, pt, COALESCE((f.attrs->>'_match_radius_m')::numeric, s.meters))
-- Because the distance referenced f.attrs, the planner could not expand a search
-- box, so every call SEQ-SCANNED all of geo_features (~284k rows / 659 MB) AND
-- detoasted every row's attrs jsonb to evaluate the COALESCE. Measured ~3.2-5.6 s
-- per call — the whole cost of a cold address-profile page load.
--
-- FIX: two stages. Stage 1 prefilters with the DATASET-level radius (s.meters — a
-- per-join-row parameter the GIST index CAN drive; migration 037's functional index
-- on (geom::geography)). Stage 2 refines the tiny candidate set with the exact
-- per-feature radius. Semantically identical because _match_radius_m is by contract
-- a TIGHTER per-source override (verified on live data 2026-07-24: max override
-- 150 m vs dataset radii ≥150 m; old-vs-new results byte-identical at Nepean,
-- Barrhaven, Union Station (18 flags incl. intersect + override paths), King West,
-- Waterloo — at 48-121 ms vs 3.0-3.4 s).
--
-- CREATE OR REPLACE only — rollback = re-run 078.

CREATE OR REPLACE FUNCTION flags_near_point(
  in_lat double precision,
  in_lng double precision,
  in_specs jsonb
)
RETURNS TABLE (kind text, attrs jsonb, distance_m integer)
LANGUAGE sql
STABLE
AS $$
  WITH cand AS (
    -- Stage 1: index-driven prefilter at the dataset radius (constant per spec row).
    SELECT
      f.kind,
      f.attrs,
      CAST(
        ST_Distance(
          f.geom::geography,
          ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography
        ) AS integer
      ) AS distance_m,
      s.meters
    FROM geo_features f
    JOIN jsonb_to_recordset(in_specs) AS s(kind text, meters int)
      ON s.kind = f.kind
    WHERE ST_DWithin(
      f.geom::geography,
      ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
      s.meters
    )
  )
  -- Stage 2: exact per-feature radius (the tighter _match_radius_m override), now
  -- evaluated over dozens of candidates instead of 284k rows.
  SELECT kind, attrs, distance_m
  FROM cand
  WHERE distance_m <= COALESCE((attrs->>'_match_radius_m')::numeric, meters)
  ORDER BY distance_m ASC
  LIMIT 40;
$$;

-- Service-role only (unchanged from 078).
REVOKE ALL ON FUNCTION flags_near_point(double precision, double precision, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flags_near_point(double precision, double precision, jsonb) TO service_role;
