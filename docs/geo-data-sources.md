# Geo "Things to Know" — data sources & runbook (Phase 2)

Precomputed, geo-joined **public-records** diligence flags (flood now; rail/traffic
later) merged into the listing page's "Things to Know" card and The Read. These are
**not** TRREB IDX/VOW data, so they are **not** VOW-gated and are computed by
deterministic PostGIS spatial SQL (no LLM, CLAUDE.md §4).

Pipeline: `migration 037` → `loadGeoData.ts` (reference polygons) →
`enrichGeoFlags.ts` (per-listing precompute) → `getListingDetail.geoFlags` (one
indexed PK lookup) → `buildDiligenceFlags(payload, geoFlags)`.

## Datasets

| Flag | Dataset | Source / endpoint | Native CRS | License |
|---|---|---|---|---|
| `flood` | Regulated floodplain (Floodline) | TRCA ArcGIS Hub — `Floodline_TRCA_Polygon/FeatureServer/1` (`services1.arcgis.com/d0ZCwU7eGKVeNiEE`), portal `https://trca-camaps.opendata.arcgis.com/` | EPSG:26917 (fetched as 4326) | TRCA Open Data Licence v1.0 — commercial use **with attribution** (`https://trca.ca/about/open-data-licence/`) |
| `rail` _(follow-up)_ | Rail corridors | Metrolinx Open Data / OpenStreetMap `railway=rail` | — | OGL-ON / ODbL |
| `traffic` _(follow-up)_ | Traffic volumes (AADT) | City of Toronto Open Data "Traffic Volumes" | — | OGL-Toronto |

Attribution is carried per-flag in `DiligenceFlag.source` and per-dataset in the
`geo_sources` table (`key, name, url, license, retrieved_on`). **Raw datasets are
not committed** — they are reloaded from source via the loader.

> Precision note: the IDX feed has **no lat/lng**. Listings are geocoded from their
> postal code (full `PostalCode`, else parsed from the address; FSA-centroid
> fallbacks are rejected). This is **postal/block-level**, not rooftop — adequate
> for sizable regulated floodplains; rooftop geocoding is a future enhancement.

## Runbook

All DB steps need `DATABASE_URL` = Supabase **Session pooler** string (port 5432,
IPv4) in `.env.local` — see CLAUDE.md §12. The direct host is IPv6-only and won't
resolve here.

```bash
# 1. Apply the schema (PostGIS + reference + listing_geo_flags). Light DDL —
#    or paste supabase/migrations/037_geo_things_to_know.sql into the SQL editor.
npx tsx scripts/admin/applyMigration037.ts

# 2. Load the TRCA floodplain polygons (idempotent; re-run after TRCA's annual update).
npx tsx scripts/worker/loadGeoData.ts
#    …or from a local download:  --file data/floodplain.geojson --srid 4326

# 3. Backfill flags for all existing listings (idempotent upserts).
npx tsx scripts/worker/enrichGeoFlags.ts            # add --dry-run to preview

# 4. Verify (spot-check a known floodplain address):
#    SELECT flags FROM listing_geo_flags WHERE listing_key = '<key>';
```

## Nightly

`.github/workflows/daily-sync.yml` runs `enrichGeoFlags.ts --since <~25h ago>`
after the core sync, `continue-on-error`. **Requires a new GitHub secret
`DATABASE_URL`** (Session pooler) — without it the step errors out and is skipped
(the core sync is never affected). The loader runs ad-hoc (datasets refresh rarely).
