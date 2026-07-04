// scripts/admin/load-zoning.ts
/**
 * Load harvested municipal zoning polygons into geo_features (kind='zoning'), so the
 * map overlay reads them via the zoning_in_bbox() PostGIS RPC (migration 050) instead
 * of holding the whole city's GeoJSON in each serverless instance's heap.
 *
 * Inputs (kept in scripts/admin/ alongside the harvesters):
 *   - zoning-<source>.geojson   (harvest-<source>-zoning.mjs — slimmed FeatureCollection)
 * Each source is registered in SOURCES below with the harvested code field.
 *
 * Per-feature attrs = { code, desc, source, zn_string, gen_zone, frontage, area, units }.
 * `desc` is the plain-language zone name (zoneName), `source` is the ZONING_SOURCES key the
 * UI resolves to municipality + by-law + attribution (src/lib/zoning/attribution.ts).
 *
 * Idempotent PER SOURCE: DELETE FROM geo_features WHERE kind='zoning' AND source_key=$1,
 * then bulk insert, so re-loading Toronto never touches other municipalities. Upserts one
 * geo_sources provenance row per source.
 *
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12).
 * Run: node scripts/admin/harvest-toronto-zoning.mjs   # produces zoning-toronto.geojson
 *      npx tsx scripts/admin/load-zoning.ts             # loads every source present
 *      npx tsx scripts/admin/load-zoning.ts toronto     # loads only the named source(s)
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { ZONING_SOURCES } from '@/lib/zoning/attribution';
dotenv.config({ path: ['.env.local', '.env'] });

const HERE = __dirname;
const INSERT_CHUNK = 200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

// Registry of harvested sources. Add a row per municipality as its harvester lands;
// `file` is relative to scripts/admin/, `codeField` is the harvested zone-code property,
// `descField` (optional) is a harvested plain-language field (else fall back to zoneName()).
// `key` must match a ZONING_SOURCES entry so each source is attributed correctly.
interface ZoningFileSource { key: string; file: string; codeField: string; descField?: string }

// Simcoe County — 11 townships, one Open Government Licence, harvested to per-township files
// by harvest-simcoe-zoning.mjs (normalized props ZONE_CODE/ZONE_DESC). Each key resolves to
// its township in ZONING_SOURCES, so the overlay attributes the OGL once and the card names
// the right township.
// wasaga-beach is EXCLUDED: its MapServer (WB_ZoningWebsite/1) suppresses geometry for
// anonymous /query in BOTH f=geojson and f=json (returnGeometry ignored, same as Toronto's
// gis.toronto.ca) — attributes come back, shapes don't. It needs an open-data GeoJSON
// DOWNLOAD source (like Toronto's CKAN); add it back once that endpoint is found.
const SIMCOE_KEYS = [
  'springwater', 'innisfil', 'oro-medonte', 'tiny', 'clearview',
  'severn', 'midland', 'ramara', 'new-tecumseth', 'bradford-west-gwillimbury',
];

// Frontenac County — 4 townships, one Open Government Licence, harvested to per-township
// files by harvest-frontenac-zoning.mjs (normalized props ZONE_CODE/ZONE_DESC).
const FRONTENAC_KEYS = [
  'north-frontenac', 'central-frontenac', 'south-frontenac', 'frontenac-islands',
];

// Commercial-clear cities (each its own open licence) — harvested to per-city files by
// harvest-cities-zoning.mjs (normalized props ZONE_CODE/ZONE_DESC). Clarington is EXCLUDED
// pending confirmation of its commercial clause (WRITTEN-NO posture).
const CITY_KEYS = [
  'hamilton', 'london', 'oakville', 'barrie', 'burlington',
  'oshawa', 'kingston', 'milton', 'niagara-falls',
];

const SOURCES: ZoningFileSource[] = [
  { key: 'toronto', file: 'zoning-toronto.geojson', codeField: 'ZN_ZONE' },
  ...SIMCOE_KEYS.map((key): ZoningFileSource => ({
    key, file: `zoning-simcoe-${key}.geojson`, codeField: 'ZONE_CODE', descField: 'ZONE_DESC',
  })),
  ...FRONTENAC_KEYS.map((key): ZoningFileSource => ({
    key, file: `zoning-frontenac-${key}.geojson`, codeField: 'ZONE_CODE', descField: 'ZONE_DESC',
  })),
  ...CITY_KEYS.map((key): ZoningFileSource => ({
    key, file: `zoning-city-${key}.geojson`, codeField: 'ZONE_CODE', descField: 'ZONE_DESC',
  })),
];

// Toronto By-law 569-2013 base zones → plain language (kept in sync with backfill-zoning.ts).
const ZONE_NAMES: Record<string, string> = {
  R: 'Residential', RD: 'Residential Detached', RS: 'Residential Semi-Detached',
  RT: 'Residential Townhouse', RM: 'Residential Multiple Dwelling', RA: 'Residential Apartment',
  CR: 'Commercial Residential', E: 'Employment (Industrial)', I: 'Institutional',
  O: 'Open Space', UT: 'Utility & Transportation',
};
function zoneName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (ZONE_NAMES[code]) return ZONE_NAMES[code];
  const c = code[0];
  return c === 'R' ? 'Residential' : c === 'C' ? 'Commercial Residential' : c === 'E' ? 'Employment'
    : c === 'I' ? 'Institutional' : c === 'O' ? 'Open Space' : undefined;
}

// Coerce raw geometry to a valid MULTIPOLYGON in EPSG:4326 (drops points/lines from bad mixes).
const GEOM_EXPR =
  'ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(g), 4326)), 3))';

interface Harvested {
  features: { geometry: AnyObj; properties: AnyObj }[];
  _source?: { municipality?: string; bylaw?: string; license?: string; attribution?: string; source?: string };
}
function readFC(p: string): Harvested | null {
  if (!fs.existsSync(p)) return null;
  const fc = JSON.parse(fs.readFileSync(p, 'utf-8'));
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return null;
  return fc as Harvested;
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!DATABASE_URL) { console.error('❌ Set DATABASE_URL (Session pooler, §12)'); process.exit(1); }

  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const wanted = only.length ? SOURCES.filter((s) => only.includes(s.key)) : SOURCES;

  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  console.log(`\n🗺️  load-zoning → geo_features (kind='zoning')`);
  console.log('==================================================================');
  try {
    for (const src of wanted) {
      const fc = readFC(path.join(HERE, src.file));
      if (!fc) { console.log(`   ⏭️  ${src.key}: ${src.file} not found — run its harvester first. Skipping.`); continue; }

      const meta = ZONING_SOURCES[src.key];
      const sourceKey = `zoning:${src.key}`;
      const geoms: string[] = [], attrsArr: string[] = [];
      for (const f of fc.features) {
        if (!f.geometry) continue;
        const p = f.properties ?? {};
        const rawCode = p[src.codeField];
        const code = typeof rawCode === 'string' ? rawCode.trim() : rawCode;
        if (!code) continue; // no/blank zone code (some sources carry whitespace slivers) → skip
        const rawDesc = src.descField ? p[src.descField] : null;
        const harvestedDesc = typeof rawDesc === 'string' ? rawDesc.trim() : rawDesc;
        geoms.push(JSON.stringify(f.geometry));
        attrsArr.push(JSON.stringify({
          code,
          desc: (harvestedDesc != null && harvestedDesc !== '' ? String(harvestedDesc) : zoneName(code)) ?? null,
          source: src.key,
          zn_string: p.ZN_STRING ?? null,
          gen_zone: p.GEN_ZONE ?? null,
          frontage: p.FRONTAGE ?? null,
          area: p.ZN_AREA ?? null,
          units: p.UNITS ?? null,
        }));
      }

      await client.query('BEGIN');
      const del = await client.query('DELETE FROM geo_features WHERE kind = $1 AND source_key = $2', ['zoning', sourceKey]);
      if (del.rowCount) console.log(`   🗑️  ${src.key}: cleared ${del.rowCount} existing rows`);

      let inserted = 0;
      for (let i = 0; i < geoms.length; i += INSERT_CHUNK) {
        const r = await client.query(
          `INSERT INTO geo_features (kind, source_key, attrs, geom)
           SELECT 'zoning', $3, a, geom FROM (
             SELECT a::jsonb AS a, ${GEOM_EXPR} AS geom
             FROM unnest($1::text[], $2::text[]) AS t(g, a)
             WHERE g IS NOT NULL
           ) q
           WHERE q.geom IS NOT NULL AND NOT ST_IsEmpty(q.geom)`,
          [geoms.slice(i, i + INSERT_CHUNK), attrsArr.slice(i, i + INSERT_CHUNK), sourceKey]
        );
        inserted += r.rowCount ?? 0;
      }

      const today = new Date().toISOString().slice(0, 10);
      await client.query(
        `INSERT INTO geo_sources (key, kind, name, url, license, feature_count, retrieved_on)
         VALUES ($1, 'zoning', $2, $3, $4, $5, $6::date)
         ON CONFLICT (key) DO UPDATE
           SET name = EXCLUDED.name, url = EXCLUDED.url, license = EXCLUDED.license,
               feature_count = EXCLUDED.feature_count, retrieved_on = EXCLUDED.retrieved_on`,
        [
          sourceKey,
          fc._source?.municipality ?? meta?.municipality ?? src.key,
          fc._source?.source ?? null,
          fc._source?.attribution ?? meta?.attribution ?? meta?.license ?? 'municipal open data',
          inserted,
          today,
        ]
      );
      await client.query('COMMIT');
      console.log(`   ✅ ${src.key}: inserted ${inserted} zoning polygons (of ${fc.features.length} features)`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('❌ load-zoning failed:', e?.message || e);
  process.exit(1);
});
