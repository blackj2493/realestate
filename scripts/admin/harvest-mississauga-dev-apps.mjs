#!/usr/bin/env node
/**
 * Harvest City of Mississauga — Development Applications → GeoJSON points for the
 * dev_application "Things to Know" flag (src/lib/property/geoDatasets.ts).
 *
 * WHY a harvester (not a registry endpoint): Mississauga has NO stable feature service — it
 * renames the service monthly (DevApps_Jan2026_WFL1, DevApps_June_2026_WFL1, …), so any
 * hardcoded URL 404s the following month. Instead we resolve the CURRENT service through the
 * stable public "Active Development Applications" web-map item, whose operational layers always
 * point at the live service. We pull the MATERIAL point layers (Approved / Rezoning /
 * Subdivision / Condominium; Site Plan dropped as the high-volume low-signal bucket).
 *
 *   node scripts/admin/harvest-mississauga-dev-apps.mjs
 *   npx tsx scripts/worker/loadGeoData.ts --dataset dev_application \
 *     --file scripts/admin/dev-apps-mississauga.geojson --source-key mississauga_dev_apps
 *
 * Output GeoJSON is gitignored (regenerate, don't commit). Coords are already WGS84 (outSR=4326).
 * Licence: City of Mississauga Terms of Use (commercial use permitted; carried in geo_sources).
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Stable "Active Development Applications" web-map item → resolves the current feature service.
const WEBMAP =
  "https://www.arcgis.com/sharing/rest/content/items/066ed4becad0493fb8aa3c71b990dbb0/data?f=json";
const OUT = fileURLToPath(new URL("./dev-apps-mississauga.geojson", import.meta.url));
const WANT = /rezon|subdiv|condominium|approved/i; // material
const DROP = /site\s*plan/i; // high-volume low-signal

async function fetchAll(base) {
  const out = [];
  let offset = 0;
  for (;;) {
    const p = new URLSearchParams({
      where: "1=1", outFields: "*", outSR: "4326", f: "geojson",
      resultOffset: String(offset), resultRecordCount: "1000",
    });
    const res = await fetch(`${base}/query?${p}`);
    if (!res.ok) throw new Error(`${base} → ${res.status}`);
    const fc = await res.json();
    if (fc.error) throw new Error(`ArcGIS error: ${JSON.stringify(fc.error)}`);
    const page = Array.isArray(fc.features) ? fc.features : [];
    out.push(...page);
    if (page.length < 1000) break;
    offset += 1000;
  }
  return out;
}

const map = await (await fetch(WEBMAP)).json();
const layers = (map.operationalLayers ?? []).filter(
  (l) => l.url && WANT.test(l.title ?? "") && !DROP.test(l.title ?? ""),
);
if (!layers.length) {
  console.error("❌ resolved no material layers from the web map — its structure may have changed");
  process.exit(1);
}
console.log("current service:", (layers[0].url || "").replace(/\/FeatureServer.*/, "/FeatureServer"));
console.log("material layers:", layers.map((l) => l.title));

const features = [];
for (const l of layers) {
  const feats = await fetchAll(String(l.url).replace(/\/+$/, ""));
  let pts = 0;
  for (const f of feats) {
    if (!f.geometry || f.geometry.type !== "Point") continue;
    features.push({ type: "Feature", geometry: f.geometry, properties: { LAYER: l.title, ...(f.properties ?? {}) } });
    pts++;
  }
  console.log(`  ${l.title}: ${pts} points`);
}
fs.writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
console.log(`✅ wrote ${features.length} Mississauga point features → ${OUT}`);
