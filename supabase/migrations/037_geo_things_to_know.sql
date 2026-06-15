-- supabase/migrations/037_geo_things_to_know.sql
--
-- Phase 2 "Things to Know" — geo-joined public-records diligence flags.
--
-- A single, generalized PostGIS reference table (geo_features) holds every public
-- dataset — flood, conservation-regulated areas, Provincially Significant Wetlands,
-- Greenbelt / Oak Ridges Moraine / Niagara Escarpment, hydro corridors, rail,
-- transit, Record of Site Condition — distinguished by `kind`. enrichGeoFlags.ts
-- runs the spatial predicates OFFLINE and writes per-listing flags into
-- listing_geo_flags; the read path point-looks-up one indexed row by listing_key.
-- No spatial query at request time (CLAUDE.md §5, Disk-IO budget).
--
-- All sources are PUBLIC records (city/provincial open data), NOT TRREB IDX/VOW, so
-- the output is NOT VOW-gated, and every flag is computed by deterministic spatial
-- SQL (ST_Intersects / ST_DWithin) — satisfies the no-LLM rule (§4) by construction.
--
-- Light DDL: paste into the Supabase SQL editor, or apply via the pooler script
-- `npx tsx scripts/admin/applyMigration037.ts` (CLAUDE.md §12).

CREATE EXTENSION IF NOT EXISTS postgis;

-- ── unified reference geodata (static; reloaded only when a dataset refreshes) ──
-- One row per source feature. `geom` is a generic geometry (polygon / line / point)
-- in EPSG:4326; distance predicates cast ::geography at query time so they measure
-- in METRES, not planar degrees (enrichGeoFlags.ts). `kind` partitions datasets;
-- `source_key` references geo_sources.key; `attrs` keeps source properties for
-- future flag refinement (e.g. wetland type, conservation designation).
CREATE TABLE IF NOT EXISTS geo_features (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,                    -- flood | wetland | greenbelt | orm | niagara | hydro | rail | transit | rsc | conservation_regulated
  source_key  text NOT NULL,                    -- references geo_sources.key (FK-ish, not enforced)
  attrs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom        geometry(Geometry, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS geo_features_gix ON geo_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS geo_features_kind_idx ON geo_features (kind);
CREATE INDEX IF NOT EXISTS geo_features_source_idx ON geo_features (source_key);

-- ── provenance / licensing / attribution ─────────────────────────────────────
-- One row per loaded source. `key` is referenced by geo_features.source_key; the
-- loader upserts this row on every ingest so the attribution carried in
-- DiligenceFlag.source stays checkable.
CREATE TABLE IF NOT EXISTS geo_sources (
  key            text PRIMARY KEY,
  kind           text,
  name           text,
  url            text,
  license        text,
  feature_count  integer,
  retrieved_on   date
);

-- ── precomputed per-listing output (the ONLY table the read path touches) ─────
-- flags is a DiligenceFlag[] (see src/lib/property/diligence.ts), merged into the
-- payload-derived flags as `external` by buildDiligenceFlags() on the page.
CREATE TABLE IF NOT EXISTS listing_geo_flags (
  listing_key  text PRIMARY KEY,
  flags        jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at  timestamptz NOT NULL DEFAULT now()
);
