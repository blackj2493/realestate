-- 063: cache each listing's block-level point on listing_geo_flags.
--
-- WHY. The weekly dev_application refresh only needs to update ONE flag, but the full
-- enrichGeoFlags sweep re-reads every listing's (large, TOASTed) full_payload and re-runs
-- all 11 spatial predicates for all ~211k listings (~50 min, Disk-IO-budget heavy — it
-- timed out in CI and tripped Supabase Disk-IO alerts). By caching the listing's point
-- here, a single-dataset refresh becomes a set-based spatial join keyed on geom over just
-- the listings NEAR a changed feature (a few thousand), never touching full_payload.
--
-- Populated by scripts/worker/enrichGeoFlags.ts: every enrich (full + nightly delta) now
-- writes geom alongside flags; a one-time `--geom-only` pass bootstraps existing rows.
-- geom is NULL when the listing has no trustworthy block-level coord (mirrors the flags=[]
-- + checked=false "couldn't check" state), so a NULL geom is correctly never flagged.
--
-- Light DDL (ADD COLUMN nullable = instant, no table rewrite; the geom GIST indexes an
-- all-NULL column instantly). Apply via the pooler (CLAUDE.md §12).

ALTER TABLE listing_geo_flags
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);

-- Functional geography GIST so a targeted refresh can index-probe the listings within N
-- metres of each feature: ST_DWithin(f.geom::geography, g.geom::geography, N).
CREATE INDEX IF NOT EXISTS listing_geo_flags_geog_gix
  ON listing_geo_flags USING GIST ((geom::geography));

-- GIN so the "currently carries flag X" clear-set — flags @> '[{"id":"X"}]', which finds
-- listings whose feature aged out so the stale flag can be removed — is instant.
CREATE INDEX IF NOT EXISTS listing_geo_flags_flags_gin
  ON listing_geo_flags USING GIN (flags jsonb_path_ops);

COMMENT ON COLUMN listing_geo_flags.geom IS
  'Block-level listing point (postal-derived, EPSG:4326) cached so a single-dataset refresh joins spatially without re-reading listings.full_payload. NULL = no trustworthy coord (same "couldn''t check" state as flags=[] + checked=false).';
