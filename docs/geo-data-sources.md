# Geo "Things to Know" — data sources & runbook (Phase 2)

Precomputed, geo-joined **public-records** diligence flags merged into the listing
page's "Things to Know" card and The Read. These are **not** TRREB IDX/VOW data, so
they are **not** VOW-gated and are computed by deterministic PostGIS spatial SQL (no
LLM, CLAUDE.md §4).

Pipeline: `migration 037` (unified `geo_features` table) → `loadGeoData.ts`
(reference geometry) → `enrichGeoFlags.ts` (per-listing precompute into
`listing_geo_flags`) → `getListingDetail.geoFlags` (one indexed PK lookup) →
`buildDiligenceFlags(payload, geoFlags)`.

**Everything is registry-driven from `src/lib/property/geoDatasets.ts`** — endpoints,
filters, predicates, severities and flag wording all live there. Add a flag = add an
entry. All endpoints below were liveness-verified (feature counts shown).

> **Coordinate precision.** The IDX feed has **no lat/lng**. Listings are geocoded
> from their postal code (full `PostalCode`, else parsed from the address; FSA-centroid
> fallbacks rejected, and full-postal coords sitting >20 km from their own FSA centroid
> rejected as corrupt source rows). This is **postal/block-level**, not rooftop —
> adequate for the sizable regulated areas below; rooftop geocoding is a future enhancement.

## Datasets

### Active — auto-loadable (ArcGIS REST, `--all`)

| Flag | Source(s) | Features | Geometry / predicate | License (commercial OK) |
|---|---|---|---|---|
| `flood` | TRCA `Floodline_TRCA_Polygon/FeatureServer/1` | 1,306 | polygon / inside | TRCA Open Data Licence v1.0 |
| `conservation_regulated` | CVC `Generic_Regulations_Limit_2025/0`, CLOCA `…/MapServer/15`, LSRCA `OpenData/MapServer/36` | 1 + 1 + 20 | polygon / inside | Conservation Authority Open Data Licence v1.0 |
| `wetland` (PSW) | LIO `LIO_Open01/MapServer/15` where `WETLAND_SIGNIFICANCE='Evaluated-Provincial'` | 80,039 | polygon / inside | OGL–Ontario |
| `greenbelt` | LIO `LIO_Open06/MapServer/15` where `DESIGNATION='Protected Countryside'` | 32 | polygon / inside | OGL–Ontario |
| `orm` | LIO `LIO_Open06/MapServer/29` | 1 | polygon / inside | OGL–Ontario |
| `niagara` | LIO `LIO_Open06/MapServer/25` | 12 | polygon / inside | OGL–Ontario |
| `hydro` | LIO `LIO_Open05/MapServer/11` where `CLASS_SUBTYPE_NUM IN (1114,1340)` | 3,451 | line / within 150 m | OGL–Ontario |
| `rsc` | Ontario ESR `Access_Environment/…/MapServer/6` | 11,814 | point / within 75 m | ⚠️ see note |

⚠️ **RSC license caveat.** The Record-of-Site-Condition data is served from a government
MapServer but is **not explicitly OGL-tagged** on that service. Confirm terms with MECP
before relying on it commercially. To ship without it, set `enabled: false` on the `rsc`
entry in `geoDatasets.ts`.

ℹ️ **`conservation_regulated` semantics.** TRCA publishes a true floodplain line (→ `flood`).
The 905 conservation authorities publish only their broader **regulation limit** (floodplain
+ valley/wetland/erosion hazards), so we label those honestly as a *conservation-regulated
area* (development-permit fact), not a floodplain.

### Active — file-based (ship as shapefile/GTFS, not ArcGIS-queryable)

| Flag | Source | Loaded | License |
|---|---|---|---|
| `rail` | Ontario Railway Network (ORWN) Track (EPSG:4269) | 19,055 LineStrings / within 150 m | OGL–Ontario |
| `transit` | GO rail stations (63) + TTC subway stations (148, via GTFS `route_type=1` join) | 211 points / within 1500 m (upside flag) | OGL–Ontario / OGL–Toronto |

**Prep recipe** (no `ogr2ogr` needed — uses `npx -y mapshaper`; data is `.gitignore`d):

```bash
mkdir -p data/_geo_src && cd data/_geo_src

# rail — ORWN track shapefile → WGS84 GeoJSON
curl -o ORWNTRK.zip https://ws.gisetl.lrc.gov.on.ca/fmedatadownload/Packages/ORWNTRK.zip
unzip -o ORWNTRK.zip
npx -y mapshaper */ORWN_TRACK.shp -proj wgs84 -o format=geojson ../orwn_track.geojson

# transit — GO stations shapefile + TTC subway (GTFS route_type=1 → trips → stop_times → stops)
curl -o go.zip https://files.ontario.ca/opendata/go_train_stations_xslttransf.zip && unzip -o go.zip -d go_stations
npx -y mapshaper go_stations/GO_Train_Stations.shp -proj wgs84 -o format=geojson go_stations.geojson
curl -o ttc.zip "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/7795b45e-e65a-4465-81fc-c36b9dfff169/resource/cfb6b2b8-6191-41e3-bda1-b175c51148cb/download/opendata_ttc_schedules.zip"
unzip -o ttc.zip routes.txt trips.txt stop_times.txt stops.txt -d ttc_gtfs
node ../../scripts/admin/buildTransitGeoJSON.cjs          # → ../transit_stations.geojson
cd ../..

# load (srid 4326 — mapshaper already reprojected) then re-run the backfill
npx tsx scripts/worker/loadGeoData.ts --dataset rail    --file data/orwn_track.geojson      --srid 4326
npx tsx scripts/worker/loadGeoData.ts --dataset transit --file data/transit_stations.geojson --srid 4326
npx tsx scripts/worker/enrichGeoFlags.ts
```

### Deferred (no reliable region-wide open data — kept in the registry, `enabled: false`)

- **`traffic` (AADT).** City of Toronto is single-day TMC (not AADT); **York & Halton are
  paywalled**; only Durham/Peel regional roads + 400-series have true open AADT. Not
  shippable region-wide. Revisit with a commercial feed (Replica/HERE) if needed.
- **Airport noise (Pearson / Billy Bishop).** PDF contour maps only — no GIS, no open
  license. Not buildable from open data.

### Coverage gaps (honest)

- **Conservation Halton** (Oakville, Burlington, Milton) publishes **no open** floodplain/
  regulation data — requires a paid licence agreement. Those municipalities have no flood/
  conservation flag until licensed.
- Fringe authorities **NVCA** (Collingwood/Shelburne) and **GRCA** (Port Hope/east Clarington)
  have data but unconfirmed open licenses — excluded.
- **Zoning** and **heritage** flags were evaluated and deferred: solid only in Toronto +
  a few municipalities (Hamilton/Oakville), patchy across the 905 — better as Toronto-first
  features than region-wide flags.

## Runbook

All DB steps need `DATABASE_URL` = Supabase **Session pooler** string (port 5432, IPv4)
in `.env.local` — CLAUDE.md §12. The direct host is IPv6-only and won't resolve here.

```bash
# 1. Apply the schema (PostGIS + geo_features + geo_sources + listing_geo_flags).
npx tsx scripts/admin/applyMigration037.ts

# 2. Load every auto-loadable dataset (flood, conservation, wetland, greenbelt, orm,
#    niagara, hydro, rsc). Idempotent per source; re-run after a dataset refresh.
npx tsx scripts/worker/loadGeoData.ts --all
#    …or one at a time:        npx tsx scripts/worker/loadGeoData.ts --dataset wetland

# 2b. File-based datasets (after converting the shapefiles to GeoJSON — see table above):
npx tsx scripts/worker/loadGeoData.ts --dataset rail    --file data/orwn_track.geojson --srid 4269
npx tsx scripts/worker/loadGeoData.ts --dataset transit --file data/transit_stations.geojson

# 3. Backfill flags for all coord-bearing listings (idempotent upserts; --dry-run to preview).
npx tsx scripts/worker/enrichGeoFlags.ts

# 4. Verify a known address:
#    SELECT flags FROM listing_geo_flags WHERE listing_key = '<key>';
#    SELECT key, kind, feature_count, license FROM geo_sources ORDER BY kind;
```

## Nightly

`.github/workflows/daily-sync.yml` runs `enrichGeoFlags.ts --since <~25h ago>` after
the core sync, `continue-on-error` (never breaks the sync). **Requires the GitHub secret
`DATABASE_URL`** (Session pooler) — without it the step errors out and is skipped. The
loader runs ad-hoc (reference datasets refresh rarely).

## Attribution (required on a public data-sources/credits page)

- "Contains information made available under the Toronto and Region Conservation Authority
  (TRCA)'s Open Data Licence v1.0" (+ equivalent for CVC / CLOCA / LSRCA).
- "Contains information licensed under the Open Government Licence – Ontario"
  (wetlands, Greenbelt, ORM, Niagara Escarpment, hydro, ORWN rail).
- "Contains information licensed under the Open Government Licence – Toronto" (TTC transit).
