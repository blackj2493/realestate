# School Catchment Boundaries on the Map — Solution & Plan (2026-06-14)

## Context

We want to draw **school attendance boundaries (catchments)** on the map, like HouseSigma
recently shipped. A previous attempt (the `School hunter` sibling project) tried to scrape
ArcGIS endpoints for 7 boards via Playwright and **all of them failed** — leading to the
conclusion that "not all cities provide ready data to create map boundaries."

That conclusion is correct, and it's the whole problem. The key reframe:

> **Rendering and storage are already solved in this codebase. The hard 95% is *data
> acquisition*, and there is no single source. The solution is a tiered acquisition
> pipeline that feeds the rendering layer we already have.**

What we already have (so we are NOT starting from scratch):
- **Rendering** — Deck.GL `PolygonLayer` overlays already work in `src/components/Map/AlphaMap.tsx`
  (commute isochrone lines 313–347, draw-to-search lines 351–398). A catchment layer is the
  same layer type.
- **Storage** — PostGIS is enabled with a clean GeoJSON pattern: `geo_features` (geom 4326,
  GIST-indexed, `ST_Intersects`/`ST_DWithin`) + `geo_sources` for provenance
  (`supabase/migrations/037_geo_things_to_know.sql`). We already load rail/transit/flood this way.
- **School points + scores** — `data/ontario-schools.json` (4,300+ schools, lat/lng, EQAO score),
  with the 4-panel model (elementary/secondary × public/catholic) in `src/lib/schools/nearestSchools.ts`
  and the UI lens in `src/lib/schools/schoolLens.ts`.
- **A dense probe set for free** — `data/Ontario-postal-code-to-coordinate.txt` (7.7 MB) and
  `data/postal-codes.json` (15.8 MB). This is what makes the reverse-engineering route cheap.

---

## The solution: a 3-tier acquisition pipeline (one render layer)

### Tier A — Harvest published boundaries (free, authoritative)
Many Ontario boards/municipalities **do** publish attendance boundaries on ArcGIS Hub or open-data
portals, even though there is no province-wide file. You query them directly:

```
GET {FeatureServer}/{layer}/query?where=1=1&outFields=*&outSR=4326&f=geojson
```

…and upsert the resulting GeoJSON straight into `geo_features` (`kind='school_catchment'`), exactly
like the existing rail/transit/flood loaders.

Confirmed-live examples (verified 2026-06-14):
- **TDSB** publishes on ArcGIS — feature services live at `services3.arcgis.com/b9WvedVPoizGfvfD/...`
  (the query mechanism resolves and returns GeoJSON).
- **Open Ottawa** (`data.ottawa.ca` / `open.ottawa.ca`) serves school datasets with GeoJSON + WFS APIs.
- Waterloo (WRDSB), Ottawa Catholic (OCSB), Peel, York, Hamilton, etc. have public boundary maps,
  most ArcGIS-backed.

**Why the past attempt failed (and the fix):** `School hunter` tried to auto-*sniff* endpoints with
Playwright and hit locked/identify-only services or looked for the wrong layer. The fix is a **one-time
human-curated discovery pass** — search ArcGIS Hub per board, confirm the FeatureServer is openly
queryable, record it in a registry — then **automate only the pulls/refreshes**. Discovery is manual
once per board; harvesting is scripted and repeatable.

Coverage: realistically the big GTA boards (TDSB, Peel, York, Halton, Ottawa, Waterloo, Hamilton)
cover the large majority of our listings. Start here for fast, authoritative coverage.

### Tier B — Reverse-engineer from the address→school lookup (free; THE answer to "no ready data")
For boards that expose **only** a "Find Your School" address lookup (no downloadable polygons):

1. **Probe** the lookup tool with a dense set of points. We already have postal-code centroids; densify
   with a synthetic grid (~150–250 m spacing) clipped to areas where we actually have listings.
2. **Label** each point with the school the tool returns (per panel: elem/sec × public/catholic × EN/FR).
3. **Reconstruct** polygons from labeled points. Best method: PostGIS `ST_VoronoiPolygons` over the
   labeled points, then **dissolve** same-label cells with `ST_Union ... GROUP BY school` → clean
   boundaries that snap between neighbours. (`ST_ConcaveHull`/alpha-shape is the simpler fallback.)
4. **Cache + rate-limit** the probes; refresh annually (boundaries change each school year).

This is the technique that resolves the original blocker. It doesn't need the board to publish anything —
only that they answer "what school is this address in?"

### Tier C — Buy it (zero-maintenance, national)
**Local Logic** (Canadian proptech) sells a Schools API that includes **catchment geometry across all of
Canada** plus ratings for ON & BC — this is the realistic source behind HouseSigma-class coverage.
No public pricing; they offer a data sample / 7-day trial / demo. Use this as the escape hatch if
babysitting dozens of board endpoints each year is more cost than it's worth.

### NOT recommended as the primary method: pure Voronoi from our 4,300 school points
Tempting (we already have the points) but **wrong**: real catchments ≠ nearest school. They follow
roads, school capacity, and programs; and public/catholic/English/French zones **overlap** — one address
sits in 4+ catchments at once. Use Voronoi-from-points **only** as a clearly-labeled *"approximate zone"*
last resort where neither A nor B is feasible, and badge it "approximate — verify with the board" in the
UI (this is decision-critical data; buyers act on it).

**Recommended path: Hybrid A + B now** (free, we control it, reuses `geo_features`), with **C as the
escape hatch.** Do Tier A for the big boards first (fast, covers most listings), then Tier B for gaps.

---

## DECISION (2026-06-15): Tier A + honest 2.5 km fallback

Agreed scope for v1: **ship real catchment polygons for boards that publish them (Tier A); for every
other board, fall back to the existing 2.5 km proximity circle with an explicit "approximate" disclaimer.**
Tier B (reverse-engineering) and Tier C (Local Logic) are deferred, not cut. Rationale: Tier A is ~80% of
the user value, the circle already exists (`synthesizeCirclePolygon`), and this avoids the all-or-nothing
trap that stalled the previous attempt.

Non-negotiable guardrails for the hybrid:

1. **The two are visually + semantically distinct. The circle is NEVER called a "boundary."**
   - Real catchment → **solid** outline, label `Attendance boundary · <Board> · <year> · official`.
   - Fallback → **dashed circle**, label `Approx. 2.5 km radius — not an official catchment. Verify with the board.`
   - In UI copy the fallback is a *proximity radius*, not a boundary. (The circle answers "what's near this
     home," not "which school is this address assigned to" — real catchments are irregular and often not
     even centered on the school. Honesty via labeling, not via making the circle look catchment-shaped.)
   - Do **not** "upgrade" the fallback to Voronoi-from-points later — it looks authoritative while being
     just as wrong, which is worse than an obvious circle.

2. **Coverage is tracked at board × PANEL granularity**, not just per board. Catchments are per-panel
   (elem/sec × public/catholic × EN/FR) and a board often publishes one panel but not another. The source
   registry carries `hasBoundaries` per (board, panel); the UI picks polygon-vs-circle per panel.

3. **Two interaction models (this simplifies the build):**
   - Real catchments = an **area overlay** toggled on, showing every zone across the viewport.
   - Circle fallback = inherently **per-school** — rendered only when a user selects/clicks a specific
     school in a no-data board. (Matches today's per-target-school circle; the work is *rendering* it —
     it's invisible today — and *badging* it, not new geometry.)

4. **Disclaimers on both layers** ("boundaries change yearly — verify with the board"); the real layer is
   "official as of <year>", the circle is "approximate, not a catchment." Decision-critical data.

---

## Discovery results (2026-06-15) — see `data/school-catchment-sources.json`

Live-verified endpoint discovery across ~26 boards (every "open" source confirmed with a token-free
`returnCountOnly` query — no repeat of the prior assume-it-works failure):

- **16 boards VERIFIED_OPEN** (loadable now): YRDSB, HDSB, HCDSB, DPCDSB, OCSB, CEPEO, WRDSB, WCDSB,
  HWDSB, UGDSB, TVDSB, SCDSB, SMCDSB (full) + TCDSB (elem only), DCDSB (Oshawa only), LDCSB (Middlesex
  elem only). Heterogeneous schemas — the registry encodes `schoolNameField` + panel discriminator per board.
- **Two big gaps = the densest markets:** **TDSB (Toronto)** has NO open polygons (private app, PDFs only);
  **PDSB (Peel)** boundaries exist only behind the proprietary keyed `api.spsplus.ca` (harvestable per-school,
  no ArcGIS, no open license).
- **Fallback (circle):** YCDSB (token-locked), DDSB, OCDSB, HWCDSB, CECCE, UCDSB.
- **Excluded:** GECDSB/WECDSB (Windsor) — polygons exist but are **CC BY-NC-SA (non-commercial)** → not usable.
- **License caveat:** most VERIFIED sources carry NO explicit license (just "shared public" on ArcGIS Online).
  Only Region of Waterloo (WRDSB/WCDSB) has a real OGL-style licence. Commercial-use posture is an open decision.

## Implementation plan (mapped to this stack)

1. **DB** — new migration reusing the existing pattern:
   `geo_features` rows with `kind='school_catchment'` and `attrs` =
   `{ school_id, board, panel: "elem_public"|"sec_catholic"|…, language, year, source_key }`.
   Add the source to `geo_sources` for provenance/licensing. (Mirrors `037_geo_things_to_know.sql`.)
   `school_id` links each polygon back to `ontario-schools.json` so a click shows the EQAO score we
   already compute.

2. **Acquisition scripts** (`scripts/admin/`, mirroring `buildTransitGeoJSON.cjs` / geo loaders):
   - `data/school-catchment-sources.json` — curated registry of confirmed board endpoints + license.
   - `harvest-school-catchments.ts` — Tier A: loop the registry, fetch `…/query?f=geojson`, upsert into
     `geo_features`.
   - `probe-school-catchments.ts` — Tier B: probe lookup tools with postal-code/grid points → label →
     reconstruct via PostGIS Voronoi-dissolve → upsert.

3. **API** — `GET /api/schools/catchments?bbox=…&panel=…` returns GeoJSON by querying `geo_features`
   (kind + panel) intersecting the viewport bbox. Read-only from the precomputed table — **no spatial
   compute at request time** (matches CLAUDE.md §5).

4. **Map UI** — add a `GeoJsonLayer`/`PolygonLayer` in `AlphaMap.tsx` (copy the existing polygon pattern
   at lines 313–398), gated by a **"School zones"** toggle wired to the existing panel selector in
   `schoolLens.ts`. Click a catchment → popup with school name + EQAO score (reuse `ListingMapPopup` +
   `/api/schools/[id]`). Always render the "verify with board / boundaries change yearly" disclaimer.

5. **Refresh** — annual cron (we have a scheduler) to re-harvest + re-probe and bump `attrs.year`.

---

## Verification

- **Tier A spot-check:** run `harvest-school-catchments.ts` for TDSB → confirm rows land in
  `geo_features` → render the layer → click the catchment over 5–10 known addresses and confirm the
  result matches the board's official "Find Your School" tool.
- **Tier B calibration:** pick a board that ALSO publishes polygons (e.g. TDSB) as ground truth; run the
  probe+reconstruct pipeline against it and tune grid density / hull params until the reconstructed
  polygon matches the published one (>~95% area overlap), then apply the tuned params to no-data boards.
- **Render/perf:** confirm bbox-scoped GeoJSON keeps payloads small and the Deck.GL layer toggles cleanly
  per panel.

## Sources
- Local Logic Schools API (Canada catchment geometry): https://locallogic.co/platform/datasets/school-data/ , https://locallogic.co/blog/canadian-school-ratings-schools-api/
- TDSB on ArcGIS (item 39846ec5…): https://www.arcgis.com/home/item.html?id=39846ec5cc484703950d6c156cb929e1 ; TDSB Open Data: https://www.tdsb.on.ca/Open-Data
- Open Ottawa (GeoJSON/WFS): https://open.ottawa.ca/ , https://data.ottawa.ca/dataset?res_format=GeoJSON
- WRDSB attendance boundary maps + address eligibility tool: https://www.wrdsb.ca/planning/school-boundary-and-location-maps/
- Ontario "Find your school": https://www.ontario.ca/page/find-your-school ; Esri "School Locator" solution: https://doc.arcgis.com/en/arcgis-solutions/11.1/reference/use-school-locator.htm
- Ontario School Boards Boundary File (board-only, 2009-10, not commercial-usable — ruled out): https://mdl.library.utoronto.ca/collections/geospatial-data/ontario-school-boards-boundary-file
- Commercial US boundary reference (Precisely): https://www.precisely.com/data-guide/products/school-boundaries/
