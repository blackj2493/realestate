/**
 * Harvest — commercial-clear CITY zoning layers to per-city GeoJSON.
 *
 * One generic harvester driven by a config table (each city = its own ArcGIS server, fields,
 * quirks), reusing the same paginate + geometry-mode-auto-detect + Esri→GeoJSON engine as the
 * Simcoe/Frontenac harvesters. Endpoints + zone-code/desc fields are the LIVE-probed values in
 * scripts/admin/zoning-sources.json (verified_open_commercial). Each `key` matches a
 * ZONING_SOURCES entry so load-zoning.ts attributes every city to its own open licence.
 *
 * Quirks handled:
 *   - Milton: service URL carries a daily-rotating datestamp → resolve the stable AGOL item id
 *     to its current layer URL at run time.
 *   - Niagara Falls: main Stamford by-law layer (79200); 3 tiny former-township by-law layers
 *     (~173 polys) are a documented minor gap.
 *   - Oshawa: only a raw-code field (DESCRIPTION), no plain-language desc.
 *
 * We request only the code (+desc) fields, so Burlington's parens fields (SHAPE.STArea()) and
 * payload bloat are avoided; field lookup is case-insensitive.
 *
 * Usage:  node scripts/admin/harvest-cities-zoning.mjs               # all
 *         node scripts/admin/harvest-cities-zoning.mjs hamilton      # one/some by key
 */
import { writeFile } from 'node:fs/promises';

const PAGE = 1000;

// key must match src/lib/zoning/attribution.ts ZONING_SOURCES; `code`/`desc` from zoning-sources.json.
const CITIES = [
  { key: 'hamilton', name: 'City of Hamilton', bylaw: 'Zoning By-law 05-200', license: 'City of Hamilton Open Data Licence',
    urls: ['https://services.arcgis.com/rYz782eMbySr2srL/arcgis/rest/services/Zoning_By_law_Boundary/FeatureServer/1'], code: 'ZONING_CODE', desc: 'ZONING_DESC' },
  { key: 'london', name: 'City of London', bylaw: 'Zoning By-law Z.-1', license: 'City of London Open Data Terms of Use',
    urls: ['https://maps.london.ca/server/rest/services/OpenData/OpenData_Community/MapServer/16'], code: 'GIS_FeatureKey', desc: 'GeneralizedLandUse' },
  { key: 'oakville', name: 'Town of Oakville', bylaw: 'Zoning By-law 2014-014', license: 'Open Government Licence – Town of Oakville',
    urls: ['https://maps.oakville.ca/oakgis/rest/services/SBS/Zoning_By_law_2014_014/FeatureServer/10'], code: 'ZONE', desc: 'ZONE_DESC' },
  { key: 'barrie', name: 'City of Barrie', bylaw: 'Comprehensive Zoning By-law', license: 'Open Government Licence – Barrie',
    urls: ['https://gispublic.barrie.ca/arcgis/rest/services/Open_Data/Planning/MapServer/0'], code: 'ZONING', desc: 'DESCRIPT' },
  { key: 'burlington', name: 'City of Burlington', bylaw: 'Zoning By-law 2020', license: 'City of Burlington Open Data Terms of Use',
    urls: ['https://mapping.burlington.ca/arcgisweb/rest/services/COB/Zoning_ByLaw/MapServer/6'], code: 'FULL_ZONING', desc: 'NOTE' },
  { key: 'oshawa', name: 'City of Oshawa', bylaw: 'Zoning By-law 60-94', license: 'Open Government Licence v2.0 – Oshawa',
    urls: ['https://map.oshawa.ca/arcgis/rest/services/Operational/PopularLayers/MapServer/17'], code: 'DESCRIPTION', desc: null },
  { key: 'kingston', name: 'City of Kingston', bylaw: 'Zoning By-law 2022-62', license: 'City of Kingston Open Data Licence',
    urls: ['https://utility.arcgis.com/usrsvcs/servers/528acb24c6da484daf8a3974a6731954/rest/services/Planning/ParentZoning/FeatureServer/0'], code: 'ZONE_CODE', desc: 'ZONE_DESC' },
  { key: 'milton', name: 'Town of Milton', bylaw: 'Zoning By-law 016-2014', license: 'Open Government Licence – Milton',
    resolveItem: '4b6840d0876b4b1494737315ab901728', layerSuffix: '8', code: 'ZONECODE', desc: 'ZONING' },
  { key: 'niagara-falls', name: 'City of Niagara Falls', bylaw: 'Zoning By-law 79-200', license: 'Open Government Licence 2.0 – Niagara Falls',
    urls: ['https://services9.arcgis.com/oMFQlUUrLd1Uh1bd/arcgis/rest/services/Niagara_Falls_Zoning_Bylaw_79200/FeatureServer/0'], code: 'ZONE_ABR', desc: 'ZONE_TTL' },
];

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

async function fetchPage(layerUrl, offset, format, fields) {
  // Keep the field-separator comma LITERAL (encode only each name) — older ArcGIS Servers
  // (e.g. Barrie's gispublic) reject a %2C-encoded comma in outFields with a generic 400.
  const of = fields && fields.length ? fields.map(encodeURIComponent).join(',') : '*';
  const url = `${layerUrl}/query?where=1%3D1&outFields=${of}&outSR=4326&returnGeometry=true&f=${format}&resultRecordCount=${PAGE}&resultOffset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error(`non-JSON response (first 140: ${txt.slice(0, 140)})`); }
  if (j.error) throw new Error(`ArcGIS error ${JSON.stringify(j.error).slice(0, 200)}`);
  return j;
}

async function resolveUrls(city) {
  if (city.urls) return city.urls;
  // Milton-style: resolve the stable AGOL item id to its current (datestamped) layer URL.
  const item = await (await fetch(`https://www.arcgis.com/sharing/rest/content/items/${city.resolveItem}?f=json`)).json();
  let u = String(item.url || '').replace(/\/$/, '');
  if (!u) throw new Error(`item ${city.resolveItem} has no url`);
  if (!/\/\d+$/.test(u)) u += `/${city.layerSuffix || '0'}`;
  return [u];
}

async function fetchLayer(url, city) {
  let fields = [city.code, city.desc].filter(Boolean);
  let format = 'geojson';

  // Fetch a page; on a generic 400 (field subset needing the OID, or f=geojson+resultOffset
  // breaking on older servers like Barrie's gispublic), permanently downgrade THIS layer to
  // the most-compatible combo (Esri f=json + outFields=*) and retry the same offset.
  async function getPage(off) {
    try {
      return await fetchPage(url, off, format, fields);
    } catch (e) {
      if (format !== 'json' && /Failed to execute query|400/i.test(String(e?.message))) {
        format = 'json';
        fields = null;
        return await fetchPage(url, off, 'json', null);
      }
      throw e;
    }
  }

  let page = await getPage(0);
  // Geometry suppressed in GeoJSON (attributes only, e.g. Wasaga-style) → switch to Esri json.
  const first = (page.features || [])[0];
  if (format === 'geojson' && (page.features || []).length > 0 && !(first && first.geometry)) {
    format = 'json';
    fields = null;
    page = await fetchPage(url, 0, 'json', null);
  }

  const out = [];
  let pulled = 0, offset = 0;
  for (;;) {
    const feats = page.features || [];
    pulled += feats.length;
    for (const f of feats) {
      const props = format === 'geojson' ? (f.properties || {}) : (f.attributes || {});
      const rawCode = pick(props, city.code);
      if (rawCode == null || String(rawCode).trim() === '') continue;
      const geom = format === 'geojson' ? f.geometry : (f.geometry && esriRingsToGeoJSON(f.geometry.rings));
      if (!geom) continue;
      out.push({
        type: 'Feature',
        properties: { ZONE_CODE: rawCode, ZONE_DESC: city.desc ? pick(props, city.desc) : null, MUNICIPALITY: city.name },
        geometry: geom,
      });
    }
    const more = page.exceededTransferLimit === true || feats.length >= PAGE;
    if (!more || feats.length === 0) break;
    offset += feats.length;
    if (offset > 500000) { console.warn(`   ⚠️  safety stop at ${offset}`); break; }
    page = await getPage(offset);
  }
  return { out, pulled, format };
}

async function harvestOne(city) {
  const urls = await resolveUrls(city);
  const slim = [];
  let pulled = 0, format = 'geojson';
  for (const url of urls) {
    const r = await fetchLayer(url, city);
    slim.push(...r.out);
    pulled += r.pulled;
    format = r.format;
  }
  const outFile = `scripts/admin/zoning-city-${city.key}.geojson`;
  await writeFile(outFile, JSON.stringify({
    type: 'FeatureCollection',
    _source: {
      municipality: city.name, bylaw: city.bylaw, license: city.license,
      attribution: `Contains information licensed under the ${city.license}.`, source: urls[0],
    },
    features: slim,
  }));
  const zones = new Set(slim.map((f) => f.properties.ZONE_CODE)).size;
  return { key: city.key, pulled, kept: slim.length, zones, format };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const wanted = only.length ? CITIES.filter((c) => only.includes(c.key)) : CITIES;
  console.log(`\n🏙️  Harvest commercial-clear city zoning → ${wanted.length} city/cities`);
  const summary = [];
  for (const c of wanted) {
    process.stdout.write(`   ${c.key} … `);
    try {
      const r = await harvestOne(c);
      console.log(`✅ ${r.kept} polygons (${r.zones} zones, f=${r.format})` + (r.pulled !== r.kept ? `  [pulled ${r.pulled}]` : ''));
      summary.push(r);
    } catch (e) {
      const cause = e?.cause?.code ? ` (${e.cause.code})` : '';
      console.log(`❌ ${e?.message || e}${cause}`);
      summary.push({ key: c.key, error: String(e?.message || e) });
    }
  }
  const ok = summary.filter((s) => !s.error);
  const total = ok.reduce((n, s) => n + s.kept, 0);
  console.log(`\n📦 ${ok.length}/${wanted.length} OK · ${total.toLocaleString()} polygons total`);
  const failed = summary.filter((s) => s.error);
  if (failed.length) console.log(`   ⚠️  failed: ${failed.map((f) => `${f.key} (${f.error})`).join('; ')}`);
}

main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
