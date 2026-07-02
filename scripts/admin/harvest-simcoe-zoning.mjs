/**
 * Harvest — Simcoe County zoning (11 lower-tier townships) to per-township GeoJSON.
 *
 * All 11 members are open under ONE commercial licence: the Open Government Licence –
 * Simcoe County (maps.simcoe.ca). Unlike Toronto (a static CKAN download), these are live
 * ArcGIS layers, so we paginate each `/query?outSR=4326&returnGeometry=true`
 * (resultOffset/resultRecordCount) and reproject server-side to WGS84.
 *
 * GEOMETRY MODE: we prefer f=geojson, but some Simcoe MapServers (e.g. Wasaga Beach)
 * SUPPRESS geometry in GeoJSON output (attributes come back, shapes don't — same quirk as
 * Toronto's gis.toronto.ca). So harvestOne() detects that from page 1 and transparently
 * falls back to f=json (Esri rings) + an Esri→GeoJSON conversion.
 *
 * Endpoints + zone-code fields are the LIVE-probed values in scripts/admin/zoning-sources.json
 * (verified_open_commercial + county_tier.additionalServices). Common field is ZONE_1;
 * exceptions: Clearview=ZONE_TYPE, Ramara/New Tecumseth=Zoning, BWG=ZoneClass.
 *
 * Output: one slim file per township, `zoning-simcoe-<key>.geojson`, with normalized
 * properties { ZONE_CODE, ZONE_DESC, TOWNSHIP } + a `_source` provenance block. `<key>`
 * matches the ZONING_SOURCES key so load-zoning.ts attributes each township correctly.
 *
 * License (MUST attribute wherever shown): Open Government Licence – Simcoe County.
 *
 * Usage:  node scripts/admin/harvest-simcoe-zoning.mjs               # all 11
 *         node scripts/admin/harvest-simcoe-zoning.mjs springwater   # one/some by key
 */
import { writeFile } from 'node:fs/promises';

const ROOT = 'https://maps.simcoe.ca/arcgis/rest/services';
const PAGE = 1000;

// key must match src/lib/zoning/attribution.ts ZONING_SOURCES.
const TOWNSHIPS = [
  { key: 'springwater',               name: 'Township of Springwater', url: `${ROOT}/Springwater/Zoning/MapServer/7`,                                      code: 'ZONE_1',    desc: 'LABEL' },
  { key: 'innisfil',                  name: 'Town of Innisfil',        url: `${ROOT}/Innisfil/INN_PUBLIC_Zoning/MapServer/0`,                             code: 'ZONE_1',    desc: 'LABEL' },
  { key: 'oro-medonte',               name: 'Township of Oro-Medonte', url: `${ROOT}/Public/Zoning_Dynamic/MapServer/2`,                                  code: 'ZONE_1',    desc: 'LABEL' },
  { key: 'tiny',                      name: 'Township of Tiny',        url: `${ROOT}/Public/Zoning_Dynamic/MapServer/3`,                                  code: 'ZONE_1',    desc: 'LABEL' },
  { key: 'clearview',                 name: 'Township of Clearview',   url: `${ROOT}/Clearview/CLE_Zoning_Boundaries_Compare_Public/FeatureServer/0`,     code: 'ZONE_TYPE', desc: 'ZONE_DESC' },
  { key: 'wasaga-beach',              name: 'Town of Wasaga Beach',    url: `${ROOT}/WasagaBeach/WB_ZoningWebsite/MapServer/1`,                           code: 'ZONE_1',    desc: 'LABEL' },
  { key: 'severn',                    name: 'Township of Severn',      url: `${ROOT}/Public/Zoning_Dynamic/MapServer/0`,                                  code: 'ZONE_1',    desc: 'LABEL' },
  { key: 'midland',                   name: 'Town of Midland',         url: `${ROOT}/Public/Zoning_Dynamic/MapServer/1`,                                  code: 'ZONE_1',    desc: 'LABEL' },
  { key: 'ramara',                    name: 'Township of Ramara',      url: `${ROOT}/Ramara/Ramara_OperationalLayers_Dynamic_Public/MapServer/1`,         code: 'Zoning',    desc: null },
  { key: 'new-tecumseth',            name: 'Town of New Tecumseth',   url: `${ROOT}/NewTecumseth/NewTecumseth_OperationalLayers_Dynamic_Public/MapServer/31`, code: 'Zoning', desc: null },
  { key: 'bradford-west-gwillimbury', name: 'Town of Bradford West Gwillimbury', url: `${ROOT}/BWG/Zoning_Bylaw_Map/MapServer/0`,                       code: 'ZoneClass', desc: null },
];

const ATTRIBUTION = 'Contains information licensed under the Open Government Licence – Simcoe County.';

// Case-insensitive property lookup (ArcGIS occasionally changes field case in output).
function pick(props, field) {
  if (!field || !props) return null;
  if (props[field] != null) return props[field];
  const lower = field.toLowerCase();
  for (const k of Object.keys(props)) if (k.toLowerCase() === lower) return props[k];
  return null;
}

// ── Esri JSON polygon → GeoJSON (for MapServers that suppress geometry in f=geojson) ──
// Esri convention: outer rings are clockwise, holes counterclockwise, outSR already applied.
function ringIsClockwise(ring) {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) total += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
  return total >= 0;
}
function pointInRing(pt, ring) {
  let inside = false;
  const x = pt[0], y = pt[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function esriRingsToGeoJSON(rings) {
  if (!Array.isArray(rings) || !rings.length) return null;
  const outers = [], holes = [];
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) continue;
    if (ringIsClockwise(ring)) outers.push([ring]); else holes.push(ring);
  }
  if (!outers.length) return null;
  for (const hole of holes) {
    const owner = outers.find((poly) => pointInRing(hole[0], poly[0]));
    if (owner) owner.push(hole);
    else outers.push([hole.slice().reverse()]); // orphan hole → treat as its own outer
  }
  return outers.length === 1 ? { type: 'Polygon', coordinates: outers[0] } : { type: 'MultiPolygon', coordinates: outers };
}

async function fetchPage(layerUrl, offset, format) {
  const url = `${layerUrl}/query?where=1%3D1&outFields=*&outSR=4326&returnGeometry=true&f=${format}&resultRecordCount=${PAGE}&resultOffset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error(`non-JSON response (first 140: ${txt.slice(0, 140)})`); }
  if (j.error) throw new Error(`ArcGIS error ${JSON.stringify(j.error).slice(0, 200)}`);
  return j;
}

async function harvestOne(t) {
  // Detect geometry mode from page 1: prefer geojson; if rows come back WITHOUT geometry,
  // the server suppresses shapes in GeoJSON → fall back to Esri json + ring conversion.
  let format = 'geojson';
  let page = await fetchPage(t.url, 0, 'geojson');
  const first = (page.features || [])[0];
  if ((page.features || []).length > 0 && !(first && first.geometry)) {
    format = 'json';
    page = await fetchPage(t.url, 0, 'json');
  }

  const slim = [];
  let pulled = 0, offset = 0;
  for (;;) {
    const feats = page.features || [];
    pulled += feats.length;
    for (const f of feats) {
      const props = format === 'geojson' ? (f.properties || {}) : (f.attributes || {});
      const rawCode = pick(props, t.code);
      if (rawCode == null || String(rawCode).trim() === '') continue;
      const geom = format === 'geojson' ? f.geometry : (f.geometry && esriRingsToGeoJSON(f.geometry.rings));
      if (!geom) continue;
      slim.push({
        type: 'Feature',
        properties: { ZONE_CODE: rawCode, ZONE_DESC: t.desc ? pick(props, t.desc) : null, TOWNSHIP: t.name },
        geometry: geom,
      });
    }
    const more = page.exceededTransferLimit === true || feats.length >= PAGE;
    if (!more || feats.length === 0) break;
    offset += feats.length;
    if (offset > 500000) { console.warn(`   ⚠️  safety stop at ${offset}`); break; }
    page = await fetchPage(t.url, offset, format);
  }

  const out = `scripts/admin/zoning-simcoe-${t.key}.geojson`;
  await writeFile(out, JSON.stringify({
    type: 'FeatureCollection',
    _source: { municipality: t.name, bylaw: 'Comprehensive Zoning By-law', license: 'OGL – Simcoe County', attribution: ATTRIBUTION, source: t.url },
    features: slim,
  }));
  const zones = new Set(slim.map((f) => f.properties.ZONE_CODE)).size;
  return { key: t.key, pulled, kept: slim.length, zones, format };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const wanted = only.length ? TOWNSHIPS.filter((t) => only.includes(t.key)) : TOWNSHIPS;
  console.log(`\n🏞️  Harvest Simcoe County zoning → ${wanted.length} township(s)`);
  const summary = [];
  for (const t of wanted) {
    process.stdout.write(`   ${t.key} … `);
    try {
      const r = await harvestOne(t);
      console.log(`✅ ${r.kept} polygons (${r.zones} zones, f=${r.format})` + (r.pulled !== r.kept ? `  [pulled ${r.pulled}]` : ''));
      summary.push(r);
    } catch (e) {
      const cause = e?.cause?.code ? ` (${e.cause.code})` : '';
      console.log(`❌ ${e?.message || e}${cause}`);
      summary.push({ key: t.key, error: String(e?.message || e) });
    }
  }
  const ok = summary.filter((s) => !s.error);
  const total = ok.reduce((n, s) => n + s.kept, 0);
  console.log(`\n📦 ${ok.length}/${wanted.length} township(s) OK · ${total.toLocaleString()} polygons total`);
  const failed = summary.filter((s) => s.error);
  if (failed.length) console.log(`   ⚠️  failed: ${failed.map((f) => `${f.key} (${f.error})`).join('; ')}`);
}

main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
