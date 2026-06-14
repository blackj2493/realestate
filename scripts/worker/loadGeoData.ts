/**
 * loadGeoData — ingest a public floodplain dataset into the PostGIS reference
 * table geo_floodplain (Phase 2 "Things to Know", migration 037).
 *
 * Default source: TRCA "Floodline TRCA Polygon" — the regulated floodplain extent
 * for the Toronto & Region jurisdiction, served from TRCA's ArcGIS Hub. Native CRS
 * is EPSG:26917 (UTM 17N); we request outSR=4326 so coordinates arrive as WGS84
 * lat/lng and match the listing points resolved in enrichGeoFlags.ts.
 *
 * Idempotent: DELETE FROM geo_floodplain WHERE source_key=$1, then bulk-insert,
 * all in one transaction; the geo_sources provenance row is upserted. Safe to
 * re-run (e.g. after TRCA's annual regulation-mapping update).
 *
 * COMPLIANCE: public open data under the TRCA Open Data Licence v1.0 (commercial
 * use permitted WITH attribution — carried in DiligenceFlag.source + geo_sources).
 * No TRREB IDX/VOW data touched; no LLM (§4).
 *
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12).
 *
 * Run (default TRCA floodplain):  npx tsx scripts/worker/loadGeoData.ts
 *   from a local file:            npx tsx scripts/worker/loadGeoData.ts --file data/floodplain.geojson --srid 4326
 *   from a single GeoJSON URL:    npx tsx scripts/worker/loadGeoData.ts --url "https://.../export.geojson"
 *   from an ArcGIS layer:         npx tsx scripts/worker/loadGeoData.ts --arcgis "https://.../FeatureServer/1"
 */

import { Client } from 'pg';
import * as fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

// ── source defaults (TRCA regulated floodplain) ──────────────────────────────
const DEFAULTS = {
  sourceKey: 'trca_floodplain',
  arcgis:
    'https://services1.arcgis.com/d0ZCwU7eGKVeNiEE/arcgis/rest/services/Floodline_TRCA_Polygon/FeatureServer/1',
  name: 'TRCA Regulated Floodplain (Floodline)',
  license: 'TRCA Open Data Licence v1.0',
  sourceUrl: 'https://trca-camaps.opendata.arcgis.com/ (Floodline_TRCA_Polygon)',
  srid: 4326, // we fetch with outSR=4326; override only for a pre-projected --file
};

const ARCGIS_PAGE = 2000; // matches the layer's maxRecordCount
const INSERT_CHUNK = 200; // features per multi-row INSERT (bounds the text[] param size)

interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}
interface GeoJsonFeature {
  type: 'Feature';
  geometry: GeoJsonGeometry | null;
}
interface FeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Page an ArcGIS FeatureServer layer into a single list of GeoJSON features (outSR=4326). */
async function fetchArcgis(layerUrl: string): Promise<GeoJsonFeature[]> {
  const base = layerUrl.replace(/\/+$/, '');
  const out: GeoJsonFeature[] = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      outSR: '4326',
      f: 'geojson',
      resultOffset: String(offset),
      resultRecordCount: String(ARCGIS_PAGE),
    });
    const res = await fetch(`${base}/query?${params.toString()}`);
    if (!res.ok) throw new Error(`ArcGIS query ${res.status}: ${await res.text()}`);
    const fc = (await res.json()) as FeatureCollection & { error?: unknown };
    if (fc.error) throw new Error(`ArcGIS error: ${JSON.stringify(fc.error)}`);
    const page = Array.isArray(fc.features) ? fc.features : [];
    out.push(...page);
    console.log(`   … fetched ${out.length} features`);
    if (page.length < ARCGIS_PAGE) break;
    offset += ARCGIS_PAGE;
  }
  return out;
}

async function loadFeatures(): Promise<GeoJsonFeature[]> {
  const file = arg('file');
  const url = arg('url');
  const arcgis = arg('arcgis') ?? (file || url ? undefined : DEFAULTS.arcgis);

  if (file) {
    console.log(`📄 Reading GeoJSON from ${file}`);
    const fc = JSON.parse(fs.readFileSync(file, 'utf-8')) as FeatureCollection;
    return Array.isArray(fc.features) ? fc.features : [];
  }
  if (url) {
    console.log(`🌐 Fetching GeoJSON from ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch ${res.status}: ${await res.text()}`);
    const fc = (await res.json()) as FeatureCollection;
    return Array.isArray(fc.features) ? fc.features : [];
  }
  console.log(`🌐 Paging ArcGIS layer ${arcgis}`);
  return fetchArcgis(arcgis as string);
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!DATABASE_URL) {
    console.error('❌ Set DATABASE_URL (Session pooler, §12)');
    process.exit(1);
  }

  const sourceKey = arg('source-key') ?? DEFAULTS.sourceKey;
  const srid = Number(arg('srid') ?? DEFAULTS.srid);
  const name = arg('name') ?? DEFAULTS.name;
  const license = arg('license') ?? DEFAULTS.license;
  const sourceUrl = arg('source-url') ?? DEFAULTS.sourceUrl;
  const retrievedOn = new Date().toISOString().slice(0, 10);

  console.log(`\n🌊 loadGeoData → geo_floodplain  (source_key=${sourceKey}, srid=${srid})`);
  console.log('==================================================================\n');

  const features = await loadFeatures();
  // Keep only polygonal geometries; the floodplain table is MultiPolygon.
  const geoms = features
    .map((f) => f.geometry)
    .filter((g): g is GeoJsonGeometry => !!g && (g.type === 'Polygon' || g.type === 'MultiPolygon'))
    .map((g) => JSON.stringify(g));
  console.log(`\n   ✅ ${geoms.length} polygon features (of ${features.length} total)\n`);
  if (geoms.length === 0) throw new Error('no polygon features found — aborting (nothing to load)');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");
  console.log('   ✅ Connected (statement_timeout disabled)\n');

  try {
    await client.query('BEGIN');
    const del = await client.query('DELETE FROM geo_floodplain WHERE source_key = $1', [sourceKey]);
    console.log(`   🗑️  cleared ${del.rowCount ?? 0} existing rows for ${sourceKey}`);

    let inserted = 0;
    for (let i = 0; i < geoms.length; i += INSERT_CHUNK) {
      const chunk = geoms.slice(i, i + INSERT_CHUNK);
      // ST_SetSRID declares the source CRS; ST_Transform → 4326 (no-op when srid=4326).
      // ST_MakeValid + CollectionExtract(.,3) + ST_Multi → clean MultiPolygon(4326).
      const r = await client.query(
        `INSERT INTO geo_floodplain (source_key, geom)
         SELECT $1,
                ST_Multi(ST_CollectionExtract(ST_MakeValid(
                  ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(g), $2::int), 4326)
                ), 3))::geometry(MultiPolygon, 4326)
         FROM unnest($3::text[]) AS g
         WHERE g IS NOT NULL`,
        [sourceKey, srid, chunk]
      );
      inserted += r.rowCount ?? 0;
      console.log(`   … inserted ${inserted}/${geoms.length}`);
    }

    await client.query(
      `INSERT INTO geo_sources (key, name, url, license, retrieved_on)
       VALUES ($1, $2, $3, $4, $5::date)
       ON CONFLICT (key) DO UPDATE
         SET name = EXCLUDED.name, url = EXCLUDED.url,
             license = EXCLUDED.license, retrieved_on = EXCLUDED.retrieved_on`,
      [sourceKey, name, sourceUrl, license, retrievedOn]
    );
    await client.query('COMMIT');

    const chk = await client.query(
      'SELECT count(*)::int AS n FROM geo_floodplain WHERE source_key = $1',
      [sourceKey]
    );
    console.log(`\n   ✅ geo_floodplain now holds ${chk.rows[0].n} rows for ${sourceKey}`);
    console.log(`   📝 geo_sources upserted (license="${license}", retrieved_on=${retrievedOn})`);
    console.log('\n==================================================================\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ loadGeoData failed:', e?.message || e);
    process.exit(1);
  });
