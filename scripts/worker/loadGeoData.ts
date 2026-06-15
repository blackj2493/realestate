/**
 * loadGeoData — ingest public geodata into the unified PostGIS reference table
 * geo_features (Phase 2 "Things to Know", migration 037). Registry-driven: every
 * dataset + endpoint + filter lives in src/lib/property/geoDatasets.ts.
 *
 * Idempotent per source: DELETE FROM geo_features WHERE source_key=$1, then
 * bulk-insert, in one transaction; the geo_sources provenance row is upserted.
 * Safe to re-run (e.g. after a dataset's annual refresh).
 *
 * COMPLIANCE: public open data licensed for commercial use WITH attribution
 * (carried in geo_sources + DiligenceFlag.source). No TRREB IDX/VOW data; no LLM.
 *
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12).
 *
 * Run (all auto-loadable ArcGIS datasets):   npx tsx scripts/worker/loadGeoData.ts --all
 *   one dataset:                             npx tsx scripts/worker/loadGeoData.ts --dataset wetland
 *   file-based (rail/transit, after ogr2ogr → GeoJSON):
 *     npx tsx scripts/worker/loadGeoData.ts --dataset rail --file data/orwn_track.geojson --srid 4269
 */

import { Client } from "pg";
import * as fs from "fs";
import dotenv from "dotenv";
import { GEO_DATASETS, type GeoDataset, type GeoDatasetSource } from "@/lib/property/geoDatasets";
dotenv.config({ path: [".env.local", ".env"] });

const ARCGIS_PAGE = 1000; // features/request — modest so simplified large polygons stay under the transfer cap
const INSERT_CHUNK = 200; // features/INSERT (bounds the text[] param size)
const MAX_FEATURES = 2_000_000; // runaway guard

interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}
interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties?: Record<string, unknown> | null;
}
interface FeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const GEOM_TYPES: Record<GeoDataset["family"], Set<string>> = {
  polygon: new Set(["Polygon", "MultiPolygon"]),
  line: new Set(["LineString", "MultiLineString"]),
  point: new Set(["Point", "MultiPoint"]),
};

/** Postgres expression that normalizes a GeoJSON string `g` (in $3 srid) → 4326. */
function geomExpr(family: GeoDataset["family"]): string {
  const xf = "ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(g), $3::int), 4326)";
  if (family === "point") return xf;
  const dim = family === "polygon" ? 3 : 2; // CollectionExtract: 3=polygon, 2=line
  return `ST_Multi(ST_CollectionExtract(ST_MakeValid(${xf}), ${dim}))`;
}

/** Page an ArcGIS FeatureServer/MapServer layer into GeoJSON features (outSR=4326). */
async function fetchArcgis(source: GeoDatasetSource): Promise<GeoJsonFeature[]> {
  const base = (source.endpoint as string).replace(/\/+$/, "");
  const out: GeoJsonFeature[] = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      where: source.where ?? "1=1",
      outFields: "*",
      outSR: "4326",
      f: "geojson",
      resultOffset: String(offset),
      resultRecordCount: String(ARCGIS_PAGE),
    });
    if (source.simplifyDeg) params.set("maxAllowableOffset", String(source.simplifyDeg));
    const res = await fetch(`${base}/query?${params.toString()}`);
    if (!res.ok) throw new Error(`ArcGIS query ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const fc = (await res.json()) as FeatureCollection & { error?: unknown };
    if (fc.error) throw new Error(`ArcGIS error: ${JSON.stringify(fc.error)}`);
    const page = Array.isArray(fc.features) ? fc.features : [];
    out.push(...page);
    console.log(`     … fetched ${out.length}`);
    if (page.length < ARCGIS_PAGE || out.length >= MAX_FEATURES) break;
    offset += ARCGIS_PAGE;
  }
  return out;
}

function readGeoJsonFile(path: string): GeoJsonFeature[] {
  const fc = JSON.parse(fs.readFileSync(path, "utf-8")) as FeatureCollection;
  return Array.isArray(fc.features) ? fc.features : [];
}

async function fetchUrl(url: string): Promise<GeoJsonFeature[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const fc = (await res.json()) as FeatureCollection;
  return Array.isArray(fc.features) ? fc.features : [];
}

/** Load one source into geo_features (idempotent) + upsert its geo_sources row. */
async function loadSource(
  client: Client,
  ds: GeoDataset,
  source: GeoDatasetSource,
  features: GeoJsonFeature[],
  srid: number,
  retrievedOn: string,
): Promise<number> {
  const allow = GEOM_TYPES[ds.family];
  const geoms: string[] = [];
  const attrs: string[] = [];
  for (const f of features) {
    if (!f.geometry || !allow.has(f.geometry.type)) continue;
    geoms.push(JSON.stringify(f.geometry));
    attrs.push(JSON.stringify(f.properties ?? {}));
  }
  console.log(`     ${geoms.length} ${ds.family} features (of ${features.length})`);
  if (geoms.length === 0) throw new Error(`no ${ds.family} features for ${source.sourceKey} — aborting`);

  await client.query("BEGIN");
  try {
    const del = await client.query("DELETE FROM geo_features WHERE source_key = $1", [source.sourceKey]);
    if (del.rowCount) console.log(`     🗑️  cleared ${del.rowCount} existing rows`);

    let inserted = 0;
    for (let i = 0; i < geoms.length; i += INSERT_CHUNK) {
      const gChunk = geoms.slice(i, i + INSERT_CHUNK);
      const aChunk = attrs.slice(i, i + INSERT_CHUNK);
      const r = await client.query(
        `INSERT INTO geo_features (kind, source_key, attrs, geom)
         SELECT $1, $2, a::jsonb, ${geomExpr(ds.family)}
         FROM unnest($4::text[], $5::text[]) AS t(g, a)
         WHERE g IS NOT NULL`,
        [ds.kind, source.sourceKey, srid, gChunk, aChunk],
      );
      inserted += r.rowCount ?? 0;
    }

    await client.query(
      `INSERT INTO geo_sources (key, kind, name, url, license, feature_count, retrieved_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date)
       ON CONFLICT (key) DO UPDATE
         SET kind = EXCLUDED.kind, name = EXCLUDED.name, url = EXCLUDED.url,
             license = EXCLUDED.license, feature_count = EXCLUDED.feature_count,
             retrieved_on = EXCLUDED.retrieved_on`,
      [source.sourceKey, ds.kind, source.name, source.endpoint ?? null, ds.license, inserted, retrievedOn],
    );
    await client.query("COMMIT");
    console.log(`     ✅ ${source.sourceKey}: ${inserted} rows`);
    return inserted;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!DATABASE_URL) {
    console.error("❌ Set DATABASE_URL (Session pooler, §12)");
    process.exit(1);
  }

  const all = process.argv.includes("--all");
  const kind = arg("dataset");
  const file = arg("file");
  const url = arg("url");
  const sridArg = arg("srid");
  const retrievedOn = new Date().toISOString().slice(0, 10);

  if (!all && !kind) {
    console.error("❌ Pass --all or --dataset <kind> (kinds: " + GEO_DATASETS.map((d) => d.kind).join(", ") + ")");
    process.exit(1);
  }

  const targets: GeoDataset[] = all
    ? GEO_DATASETS.filter((d) => d.enabled && d.autoLoad)
    : GEO_DATASETS.filter((d) => d.kind === kind);
  if (targets.length === 0) {
    console.error(`❌ No matching dataset for --dataset ${kind}`);
    process.exit(1);
  }

  console.log(`\n🌍 loadGeoData → geo_features  (${all ? "ALL auto-load datasets" : `dataset=${kind}`})`);
  console.log("==================================================================\n");

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  let total = 0;
  try {
    for (const ds of targets) {
      console.log(`\n📦 ${ds.kind} (${ds.family})`);
      // File/URL override (single source — for file-based datasets like rail/transit).
      if (file || url) {
        const source = ds.sources[arg("source-key") ? ds.sources.findIndex((s) => s.sourceKey === arg("source-key")) : 0];
        if (!source) throw new Error(`no source for ${ds.kind}`);
        const srid = Number(sridArg ?? source.srid ?? 4326);
        const features = file ? readGeoJsonFile(file) : await fetchUrl(url as string);
        total += await loadSource(client, ds, source, features, srid, retrievedOn);
        continue;
      }
      // ArcGIS endpoints from the registry.
      for (const source of ds.sources) {
        if (!source.endpoint) {
          console.log(`     ⏭️  ${source.sourceKey}: file-based source — load with --dataset ${ds.kind} --file <geojson>`);
          continue;
        }
        console.log(`   → ${source.sourceKey}`);
        const features = await fetchArcgis(source);
        total += await loadSource(client, ds, source, features, 4326, retrievedOn);
      }
    }
    console.log(`\n   ✅ geo_features total inserted this run: ${total}`);
    console.log("\n==================================================================\n");
  } catch (err) {
    const e = err as { message?: string };
    console.error("\n❌ loadGeoData failed:", e.message);
    throw err;
  } finally {
    await client.end();
    console.log("🔌 Connection closed.\n");
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
