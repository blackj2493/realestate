-- supabase/migrations/037_geo_things_to_know.sql
--
-- Phase 2 "Things to Know" — geo-joined public-records diligence flags.
--
-- Adds PostGIS reference tables for NON-MLS open data (flood/rail/traffic) and a
-- single precomputed per-listing output table (listing_geo_flags) that the read
-- path point-looks-up by listing_key. No per-request spatial queries ever
-- (CLAUDE.md §5, Disk-IO budget) — enrichGeoFlags.ts computes flags into
-- listing_geo_flags; getListingDetail reads one indexed row.
--
-- These are PUBLIC records (the city's own flood maps), NOT TRREB IDX/VOW data,
-- so the output is NOT VOW-gated and is computed by deterministic spatial SQL
-- (ST_Intersects / ST_DWithin) — satisfies the no-LLM rule (§4) by construction.
--
-- Light DDL: safe to paste into the Supabase SQL editor, or apply via the pooler
-- script `npx tsx scripts/admin/applyMigration037.ts` (CLAUDE.md §12).

CREATE EXTENSION IF NOT EXISTS postgis;

-- ── reference geodata (static; reloaded only when a dataset is refreshed) ──────
-- geom stored in EPSG:4326 (WGS84 lat/lng). Distance predicates cast ::geography
-- at query time so they measure in METRES, not planar degrees (enrichGeoFlags.ts).

-- Regulated floodplain / flood-hazard limit polygons (TRCA, Ontario GeoHub).
CREATE TABLE IF NOT EXISTS geo_floodplain (
  id          bigserial PRIMARY KEY,
  source_key  text NOT NULL,                          -- references geo_sources.key (FK-ish, not enforced)
  geom        geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS geo_floodplain_gix ON geo_floodplain USING GIST (geom);

-- Rail corridors (GO + freight). Phase 2 follow-up; table created now so the
-- loader/enrichment can add the `rail` predicate without a second migration.
CREATE TABLE IF NOT EXISTS geo_rail_lines (
  id          bigserial PRIMARY KEY,
  source_key  text NOT NULL,
  geom        geometry(MultiLineString, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS geo_rail_lines_gix ON geo_rail_lines USING GIST (geom);

-- Traffic volumes (AADT) at intersections/segments. Phase 2 follow-up.
CREATE TABLE IF NOT EXISTS geo_traffic_counts (
  id          bigserial PRIMARY KEY,
  source_key  text NOT NULL,
  aadt        integer,
  geom        geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS geo_traffic_counts_gix ON geo_traffic_counts USING GIST (geom);

-- ── provenance / licensing / attribution ─────────────────────────────────────
-- One row per loaded dataset. `key` is referenced by *.source_key above; the
-- loader upserts this row (name/url/license/retrieved_on) on every ingest so the
-- attribution carried in DiligenceFlag.source stays checkable.
CREATE TABLE IF NOT EXISTS geo_sources (
  key           text PRIMARY KEY,
  name          text,
  url           text,
  license       text,
  retrieved_on  date
);

-- ── precomputed per-listing output (the ONLY table the read path touches) ─────
-- flags is a DiligenceFlag[] (see src/lib/property/diligence.ts), merged into the
-- payload-derived flags as `external` by buildDiligenceFlags() on the page.
CREATE TABLE IF NOT EXISTS listing_geo_flags (
  listing_key  text PRIMARY KEY,
  flags        jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at  timestamptz NOT NULL DEFAULT now()
);
