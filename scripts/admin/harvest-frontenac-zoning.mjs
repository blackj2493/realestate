/**
 * Harvest — Frontenac County zoning (4 lower-tier townships) to per-township GeoJSON.
 *
 * All 4 members are open under ONE commercial licence: the Open Government Licence –
 * County of Frontenac. Per-township hosted FeatureServices on the County AGOL org
 * (services2.arcgis.com/vJlmDE1PmdTcJF0N). We paginate each `/query?outSR=4326` and
 * reproject server-side to WGS84 (native SR is UTM18N / 26918).
 *
 * Field names VARY per township (LIVE-probed in scripts/admin/zoning-sources.json →
 * county_tier[Frontenac County]): NF/CF/FI code=Zoning, SF code=Zone_Code; desc SF=Zone_Label,
 * FI=Label (NF/CF have no clean land-use desc → code only). We normalize each into
 * { ZONE_CODE, ZONE_DESC, TOWNSHIP }.
 *
 * Same geometry-mode auto-detect as harvest-simcoe-zoning.mjs (prefer f=geojson; fall back
 * to f=json + Esri-ring→GeoJSON if a server suppresses geometry). Hosted FeatureServers
 * usually return geometry via geojson, but we stay robust.
 *
 * License (MUST attribute wherever shown): Open Government Licence – County of Frontenac.
 *
 * Usage:  node scripts/admin/harvest-frontenac-zoning.mjs                    # all 4
 *         node scripts/admin/harvest-frontenac-zoning.mjs frontenac-islands  # one/some by key
 */
import { writeFile } from 'node:fs/promises';

const ORG = 'https://services2.arcgis.com/vJlmDE1PmdTcJF0N/arcgis/rest/services';
const PAGE = 1000;

// key must match src/lib/zoning/attribution.ts ZONING_SOURCES.
const TOWNSHIPS = [
  { key: 'north-frontenac',    name: 'Township of North Frontenac',   url: `${ORG}/NF_Zoning_View/FeatureServer/0`, code: 'Zoning',    desc: null },
  { key: 'central-frontenac',  name: 'Township of Central Frontenac', url: `${ORG}/CF_Zoning_View/FeatureServer/0`, code: 'Zoning',    desc: null },
  { key: 'south-frontenac',    name: 'Township of South Frontenac',   url: `${ORG}/SF_Zoning_View/FeatureServer/0`, code: 'Zone_Code', desc: 'Zone_Label' },
  { key: 'frontenac-islands',  name: 'Township of Frontenac Islands', url: `${ORG}/FI_Zoning_View/FeatureServer/0`, code: 'Zoning',    desc: 'Label' },
];

const ATTRIBUTION = 'Contains information licensed under the Open Government Licence – County of Frontenac.';

// Case-insensitive property lookup (ArcGIS occasionally changes field case in output).
function pick(props, field) {
  if (!field || !props) return null;
  if (props[field] != null) return props[field];
  const lower = field.toLowerCase();
  for (const k of Object.keys(props)) if (k.toLowerCase() === lower) return props[k];
  return null;
}

// ── Esri JSON polygon → GeoJSON (for servers that suppress geometry in f=geojson) ──
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
    else outers.push([hole.slice().reverse()]);
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

  const out = `scripts/admin/zoning-frontenac-${t.key}.geojson`;
  await writeFile(out, JSON.stringify({
    type: 'FeatureCollection',
    _source: { municipality: t.name, bylaw: 'Comprehensive Zoning By-law', license: 'OGL – County of Frontenac', attribution: ATTRIBUTION, source: t.url },
    features: slim,
  }));
  const zones = new Set(slim.map((f) => f.properties.ZONE_CODE)).size;
  return { key: t.key, pulled, kept: slim.length, zones, format };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const wanted = only.length ? TOWNSHIPS.filter((t) => only.includes(t.key)) : TOWNSHIPS;
  console.log(`\n🏝️  Harvest Frontenac County zoning → ${wanted.length} township(s)`);
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
