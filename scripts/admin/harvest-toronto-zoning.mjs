/**
 * Harvest — City of Toronto zoning by-law areas (By-law 569-2013) to GeoJSON.
 *
 * First source of the zoning pipeline (Phase 1). Toronto is the priority source because it
 * uniquely carries by-right DENSITY attributes (frontage / area / units) — the real builder
 * signal.
 *
 * IMPORTANT: the gis.toronto.ca ArcGIS MapServer returns ATTRIBUTES ONLY (geometry is
 * suppressed for anonymous /query — returnGeometry is ignored). The authoritative geometry is
 * the City's Open Data CKAN download ("Zoning Area - 4326.geojson", already WGS84). We pull
 * that and slim it to the fields we display/derive from.
 *
 * License (MUST attribute wherever shown): Open Government Licence – Toronto.
 *
 * Usage:  node scripts/admin/harvest-toronto-zoning.mjs [outPath.geojson]
 */
import { writeFile } from 'node:fs/promises';

const CKAN =
  'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/34927e44-fc11-4336-a8aa-a0dfb27658b7/resource/d75fa1ed-cd04-4a0b-bb6d-2b928ffffa6e/download/zoning-area-4326.geojson';
const OUT = process.argv[2] || 'scripts/admin/zoning-toronto.geojson';
// Zone code + full string + by-right density fields (‑1 is Toronto's "no value" sentinel).
const KEEP = ['ZN_ZONE', 'ZN_STRING', 'GEN_ZONE', 'FRONTAGE', 'ZN_AREA', 'UNITS'];
const SOURCE = {
  municipality: 'City of Toronto',
  bylaw: 'Zoning By-law 569-2013',
  license: 'OGL-Toronto',
  attribution: 'Contains information licensed under the Open Government Licence – Toronto.',
  source: CKAN,
  zoneField: 'ZN_ZONE',
};

async function main() {
  console.log(`\n🏙️  Harvest Toronto zoning (CKAN) → ${OUT}`);
  const res = await fetch(CKAN);
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading CKAN GeoJSON`);
  const fc = JSON.parse(await res.text());
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error('CKAN payload is not a FeatureCollection');

  const slim = fc.features
    .filter((f) => f.geometry)
    .map((f) => {
      const p = {};
      for (const k of KEEP) {
        const v = f.properties?.[k];
        if (v !== null && v !== undefined && v !== '' && v !== -1) p[k] = v;
      }
      return { type: 'Feature', properties: p, geometry: f.geometry };
    });

  await writeFile(OUT, JSON.stringify({ type: 'FeatureCollection', _source: SOURCE, features: slim }));

  const withCode = slim.filter((f) => f.properties.ZN_ZONE).length;
  const withUnits = slim.filter((f) => f.properties.UNITS).length;
  const zones = [...new Set(slim.map((f) => f.properties.ZN_ZONE).filter(Boolean))].sort();
  console.log(`✅ ${slim.length} polygons (of ${fc.features.length}). ZN_ZONE: ${withCode}; by-right UNITS present: ${withUnits}.`);
  console.log(`   distinct base zones (${zones.length}): ${zones.join(', ')}`);
  console.log(`   sample: ${JSON.stringify(slim[0]?.properties)} geom=${slim[0]?.geometry?.type}`);
}

main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
