# Phase 2 — "Things to Know": Geo-Joined Public-Records Flags

**Status:** ready to build · **Prereq:** Phase 1 shipped (see §1) · **Owner:** _new agent_
**Audience:** an engineer/agent with NO prior context on this feature. Read §0–§2 fully before writing code.

---

## 0. Context (read first)

**Product.** PureProperty.ca is the "Bloomberg Terminal for Canadian real estate" — a data-dense terminal for analytical investors/flippers/builders (`CLAUDE.md §1`). Its wedge is **institutional-grade "shadow data" that consumer brokerages obscure**.

**Why this feature matters strategically.** "Things to Know" surfaces *due-diligence facts* about a listing. Phase 1 used facts already in the MLS payload. **Phase 2 adds facts from NON-MLS public records** (flood maps, rail corridors, traffic counts). This is the most defensible data on the site: it is **not TRREB/board data**, so it is **not subject to IDX/VOW display rules and cannot trigger feed revocation** — no board can object to you publishing the city's own flood map. Build it on public data and your own computation.

**Compliance (`CLAUDE.md §4`).** All derived metrics must be **deterministic, no LLM**. This feature is pure spatial SQL (`ST_Intersects` / `ST_DWithin`) — it satisfies §4 by construction. Do **not** pass anything through an LLM. The listing's lat/lng comes from the IDX feed, but the *output* is a public-records fact computed by spatial join — that is allowed.

**Golden rule:** Phase 2 changes **no UI**. It only produces a `DiligenceFlag[]` and feeds it into the seam Phase 1 already built. If you find yourself editing the card or The Read, stop — you've gone off-plan.

---

## 1. What Phase 1 already built (the seam you plug into)

| File | What it is |
|---|---|
| `src/lib/property/diligence.ts` | `buildDiligenceFlags(payload, external: DiligenceFlag[] = [])` — interprets MLS-payload fields into flags, then **merges `external` and re-sorts**. **`external` is your Phase 2 entry point.** |
| `src/components/Property/ThingsToKnowCard.tsx` | Renders `DiligenceFlag[]` (warnings amber, info cyan, source + "worth asking"). **Do not touch.** |
| `src/lib/property/theRead.ts` | `buildTheRead(view, flags: DiligenceFlag[])` folds `kind:"warn"` flags into its "catch". **Do not touch.** |
| `src/app/(app)/properties/[id]/page.tsx` | Computes `const diligenceFlags = buildDiligenceFlags(view.full_payload);` then passes it to both the card and The Read. **You will change this one line** to pass geo-flags as the 2nd arg. |

**The exact type (already defined in `diligence.ts` — do not redefine):**
```ts
export interface DiligenceFlag {
  id: string;                 // stable key, e.g. "flood", "rail", "traffic"
  kind: "warn" | "info";
  severity: number;           // 0–100; ranks in the card AND in The Read's catch
  title: string;              // the fact, plain English (becomes a catch clause when warn)
  source: string;             // attribution — what makes it checkable (e.g. "TRCA floodplain mapping")
  ask?: string;               // optional "worth asking" prompt
}
```

**Your job:** produce `DiligenceFlag[]` from public geodata, geo-joined by each listing's lat/lng, and deliver it to the page as `external`. Nothing about the card or The Read changes.

---

## 2. Architecture — precompute, never scan at request time

This repo's law (`CLAUDE.md §5`, Disk-IO budget): the frontend never runs heavy spatial queries at request time. Every derived dataset is **precomputed into an indexed table** and read with a single PK point-lookup (see `condo_fee_stats`, `property_sale_history`, campaign history in `getListingDetail.ts` for the established pattern). Follow it exactly.

```
 EXTERNAL OPEN DATA                 SUPABASE (PostGIS = "The Vault")            READ PATH
 ┌────────────────┐    loader   ┌──────────────────────────────┐
 │ TRCA flood GeoJSON│──────────▶│ geo_floodplain (POLYGON)     │
 │ Metrolinx/OSM rail│──────────▶│ geo_rail_lines (LINESTRING)  │   nightly    ┌───────────────────────────┐
 │ City traffic AADT │──────────▶│ geo_traffic_counts (POINT)   │──enrichment─▶│ listing_geo_flags         │
 └────────────────┘             └──────────────────────────────┘   (spatial   │  listing_key PK           │
                                                                      join)     │  flags JSONB (DiligenceFlag[])│
                                                                                └────────────┬──────────────┘
                                                                                             │ 1 indexed lookup
                                                                                getListingDetail() → ListingDetail.geoFlags
                                                                                             │
                                                          page: buildDiligenceFlags(view.full_payload, view.geoFlags)
                                                                                             │
                                                                    ThingsToKnowCard + The Read (UNCHANGED)
```

**Key insight that makes this cheap:** flood polygons and rail lines are *static*, and a listing's coordinates are *static per listing*. So geo-flags only need (re)computation when a **new listing** appears. Backfill once for all existing listings; nightly, only enrich listings synced since the last run. No per-request spatial queries, ever.

**Not VOW-gated.** Public-records facts aren't TRREB data — do **not** null them in `gateVowDerived`. They render for anonymous users too (on-brand: the honest layer is freely visible).

---

## 3. Datasets (GTA / TRREB region first)

| Flag id | Dataset | Source | Format | Predicate | sev / kind |
|---|---|---|---|---|---|
| `flood` | Regulated floodplain / flood hazard limit | **TRCA Open Data** (Toronto & Region Conservation Authority); Ontario GeoHub as backup | Shapefile / GeoJSON polygons | listing point **inside** polygon (`ST_Intersects`) | 70 / warn |
| `rail` | Rail corridors (GO + freight) | **Metrolinx Open Data**; **OpenStreetMap** `railway=rail` is a reliable free fallback | LineString | point **within ~150 m** of a line (`ST_DWithin`); store the measured distance | 40 / warn |
| `traffic` | Traffic volumes (AADT) at intersections/segments | **City of Toronto Open Data** ("Traffic Volumes"); MTO for highways | Points (with volume attr) | nearest count **within ~120 m** and volume above a threshold | 38 / warn |
| `airport_noise` _(optional, later)_ | Aircraft noise contours (NEF/NEM) | **GTAA / NAV CANADA** (Pearson), Billy Bishop | Polygons | point inside contour | 30 / info |

**Licensing:** these are open-data (mostly Open Government Licence – Ontario/Canada or municipal equivalents) — commercial use permitted **with attribution**. Attribution is already carried per-flag in `DiligenceFlag.source`; keep it accurate. Record each dataset's license + retrieval date in a `geo_sources` table (see §4.1).

**Start with `flood` only** — cleanest polygon-containment join, highest user value, proves the whole pipeline end-to-end. Add `rail`, then `traffic`, in follow-up PRs.

---

## 4. Implementation — sub-phases (each independently shippable + verifiable)

> Build and verify in this order. Land flood end-to-end before adding datasets.

### 4.1 — PostGIS + reference schema (migration)
PostGIS is already used for zoning overlays (`CLAUDE.md §5`) — confirm the extension, enable if missing. Add a migration `src/.../migrations/0NN_geo_things_to_know.sql` (match the repo's existing migration numbering/location — check `scripts/admin/applyMigration*.ts` and existing `0NN_*.sql` files for the convention).

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- reference geodata (static; reloaded only when a dataset is refreshed)
CREATE TABLE IF NOT EXISTS geo_floodplain (
  id          bigserial PRIMARY KEY,
  source_key  text NOT NULL,                 -- FK-ish to geo_sources.key
  geom        geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS geo_floodplain_gix ON geo_floodplain USING GIST (geom);

CREATE TABLE IF NOT EXISTS geo_rail_lines (
  id bigserial PRIMARY KEY, source_key text NOT NULL,
  geom geometry(MultiLineString, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS geo_rail_lines_gix ON geo_rail_lines USING GIST (geom);

CREATE TABLE IF NOT EXISTS geo_traffic_counts (
  id bigserial PRIMARY KEY, source_key text NOT NULL,
  aadt integer, geom geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS geo_traffic_counts_gix ON geo_traffic_counts USING GIST (geom);

-- provenance / licensing / attribution
CREATE TABLE IF NOT EXISTS geo_sources (
  key text PRIMARY KEY, name text, url text, license text, retrieved_on date
);

-- precomputed per-listing output (the only table the read path touches)
CREATE TABLE IF NOT EXISTS listing_geo_flags (
  listing_key text PRIMARY KEY,
  flags       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- DiligenceFlag[]
  computed_at timestamptz NOT NULL DEFAULT now()
);
```
**DB connection gotcha (`CLAUDE.md §12` — critical):** admin/migration scripts must use `DATABASE_URL` = Supabase **Session pooler** string (port **5432**, IPv4). `DIRECT_DB_URL` is IPv6-only and won't resolve locally/CI. Heavy ops run from a pooler-connected script with `SET statement_timeout TO '0'`, batched by id cursor (pattern: `scripts/admin/backfill020.ts`). Instant DDL is fine in the Supabase SQL editor; full-table updates are not.

### 4.2 — Dataset loader (`scripts/worker/loadGeoData.ts`)
A standalone script that downloads/reads a GeoJSON (or shapefile→GeoJSON via `ogr2ogr`/`mapshaper`) and bulk-inserts into the reference table. Idempotent: `DELETE FROM geo_floodplain WHERE source_key=$1` then insert, wrapped in a txn; upsert the `geo_sources` row. Reproject to 4326 if the source isn't already (`ST_Transform`). Commit the loader, **not** the raw datasets (document the source URLs in `geo_sources` + a README).

### 4.3 — Enrichment (`scripts/worker/enrichGeoFlags.ts`)
Set-based, batched by listing id cursor. Extract lat/lng from the listing (confirm exact keys against `.claude/docs/api/trreb-idx-payload.md` + a sample row — likely `full_payload->>'Latitude'` / `'Longitude'`; some listings lack coords → skip them). For each batch, compute flags and upsert into `listing_geo_flags`. **Distance must be metric → cast to `geography`** (4326 degrees ≠ meters):

```sql
WITH pts AS (
  SELECT listing_key,
         ST_SetSRID(ST_MakePoint(
           (full_payload->>'Longitude')::float8,
           (full_payload->>'Latitude')::float8), 4326) AS geom
  FROM listings
  WHERE full_payload ? 'Latitude' AND full_payload ? 'Longitude'
    AND id > $cursor ORDER BY id LIMIT $batch
)
SELECT p.listing_key,
  EXISTS (SELECT 1 FROM geo_floodplain f WHERE ST_Intersects(f.geom, p.geom)) AS in_flood,
  (SELECT MIN(ST_Distance(r.geom::geography, p.geom::geography))
     FROM geo_rail_lines r
     WHERE ST_DWithin(r.geom::geography, p.geom::geography, 200)) AS rail_m,
  (SELECT MAX(t.aadt) FROM geo_traffic_counts t
     WHERE ST_DWithin(t.geom::geography, p.geom::geography, 120)) AS near_aadt
FROM pts p;
```
Map each row → `DiligenceFlag[]` in TS (so wording/severity stays consistent with `diligence.ts`), then upsert the JSONB. Example builder:
```ts
function geoFlagsFor(row): DiligenceFlag[] {
  const out: DiligenceFlag[] = [];
  if (row.in_flood)
    out.push({ id: "flood", kind: "warn", severity: 70,
      title: "Within a regulated floodplain", source: "TRCA floodplain mapping",
      ask: "Confirm flood insurance availability and any TRCA development permit." });
  if (row.rail_m != null && row.rail_m < 150)
    out.push({ id: "rail", kind: "warn", severity: 40,
      title: `${Math.round(row.rail_m)} m from a rail corridor`, source: "Metrolinx / OSM rail GIS",
      ask: "Check noise/vibration at peak hours before you commit." });
  if (row.near_aadt != null && row.near_aadt >= 8000)
    out.push({ id: "traffic", kind: "warn", severity: 38,
      title: `Fronts a busy road (~${row.near_aadt.toLocaleString()} vehicles/day)`,
      source: "City traffic counts (AADT)", ask: "Visit at rush hour." });
  return out;
}
```
**Delta mode:** accept a `--since <timestamp>` flag; when set, only enrich listings with `synced_at > since` (new/changed). Full backfill when omitted. Keep a `geo_enrich_state` row (or reuse `sync_state`) for the cursor.

### 4.4 — Read path
1. `src/lib/property/getListingDetail.ts`:
   - Add to the `ListingDetail` interface: `geoFlags: DiligenceFlag[];` (import the type from `@/lib/property/diligence`).
   - Add a **best-effort** point-lookup mirroring the `feeStability`/`saleHistory` blocks: `supabase.from("listing_geo_flags").select("flags").eq("listing_key", listingKey).maybeSingle()` wrapped in try/catch + `withTimeout(...)`; default `geoFlags: []` on miss/error. Validate the JSONB shape defensively (it's `DiligenceFlag[]`).
   - Return `geoFlags` in the final object.
   - **`gateVowDerived`:** do nothing — `{...detail}` passes `geoFlags` through. Public data is **not** gated. (Add a one-line comment saying so, so a future reviewer doesn't "fix" it.)
2. `src/app/(app)/properties/[id]/page.tsx`: change the single line
   `const diligenceFlags = buildDiligenceFlags(view.full_payload);`
   →
   `const diligenceFlags = buildDiligenceFlags(view.full_payload, view.geoFlags);`
   That's the **only** UI-adjacent change. The card and The Read pick it up automatically.

### 4.5 — Schedule
Add an enrichment step to `.github/workflows/daily-sync.yml` (`CLAUDE.md §12`) **after** the listing sync, in delta mode: `npx tsx scripts/worker/enrichGeoFlags.ts --since <last-sync>`. Mark it `continue-on-error: true` (like the alerts step) so it can never break the core sync. Loader runs ad-hoc/manually (datasets refresh rarely).

---

## 5. Acceptance criteria
- [ ] Migration applies cleanly via the pooler script; PostGIS enabled; all 5 tables + GIST indexes exist.
- [ ] Loader ingests the flood dataset; `SELECT count(*) FROM geo_floodplain > 0`; `geo_sources` row present with license + date.
- [ ] Backfill populates `listing_geo_flags` for all coord-bearing listings; spot-check 3 known-floodplain addresses → `flood` flag present; 3 known-dry → absent.
- [ ] `getListingDetail` returns `geoFlags`; anonymous request still includes them (not gated).
- [ ] A floodplain listing's page shows the flood flag in **Things to Know** AND the catch line in **The Read** — with zero edits to those components.
- [ ] `npx tsc --noEmit` → 0 errors; `npx eslint src` clean on touched files; unit tests for `geoFlagsFor` mapping (pure fn) pass.
- [ ] Nightly workflow runs the enrich step in delta mode and is `continue-on-error`.

## 6. Guardrails / gotchas recap
- **No LLM** anywhere (§4). Pure SQL + deterministic TS mapping.
- **Never** alter `raw_vow_sold` (read-only, ~217k rows, §12).
- **DATABASE_URL = Session pooler (5432)**, not Transaction pooler (6543), not DIRECT (IPv6). Heavy ops: `statement_timeout=0` + batch.
- **Distance in meters → `::geography`** cast (don't trust planar degree distance).
- **Idempotent** loader + upserts; safe to re-run.
- Confirm lat/lng keys against `.claude/docs/api/trreb-idx-payload.md` before assuming `Latitude`/`Longitude`.
- Keep flag `title`/`severity` wording consistent with the Phase-1 voice in `src/lib/property/diligence.ts`.

## 7. Suggested first PR
Flood only, end-to-end: migration + `geo_sources` + `geo_floodplain` → `loadGeoData.ts` (flood) → `enrichGeoFlags.ts` (flood predicate, full backfill) → `getListingDetail.geoFlags` + the one page line. Ship, verify on a known floodplain address, then add `rail` and `traffic` as thin follow-ups (same enrichment script, more predicates).
