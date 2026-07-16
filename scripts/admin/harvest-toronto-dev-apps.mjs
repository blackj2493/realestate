#!/usr/bin/env node
/**
 * Harvest City of Toronto — Development Applications (CKAN) → GeoJSON points for the
 * dev_application "Things to Know" flag (src/lib/property/geoDatasets.ts).
 *
 * WHY a harvester (not an ArcGIS endpoint like the other cities): Toronto's CKAN datastore
 * SQL API is disabled for this resource, and the X/Y columns are MTM zone 10 NAD27
 * (EPSG:2019), not lat/long. So we download the JSON dump, filter to RECENT + HIGH-IMPACT
 * applications (mirroring the Hamilton/Ottawa/Waterloo materiality calibration), and emit
 * the raw MTM X/Y as GeoJSON coordinates. loadGeoData does the projection:
 *
 *   node scripts/admin/harvest-toronto-dev-apps.mjs
 *   npx tsx scripts/worker/loadGeoData.ts --dataset dev_application \
 *     --file scripts/admin/dev-apps-toronto.geojson --srid 2019 --source-key toronto_dev_apps
 *
 * The output GeoJSON is gitignored (like the zoning harvests) — regenerate it, don't commit.
 * Licence: Open Government Licence – Toronto (commercial use permitted; carried in geo_sources).
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// CKAN JSON dump of package `development-applications` (resource 778b8927…).
const DUMP =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/0aa7e480-9b48-4919-98e0-6af7615b7809/resource/778b8927-2b7c-4d45-8037-8cb37a290b64/download/development-applications.json";
const OUT = fileURLToPath(new URL("./dev-apps-toronto.geojson", import.meta.url));

const YEAR_MIN = 2024; // active pipeline only (bump annually — matches the other cities)
// High-impact Toronto application-type codes (finalized after inspecting the logged
// distribution below): OZ = OPA & Rezoning, ZR/ZBL = Rezoning, OP = Official Plan Amendment,
// SB = Draft Plan of Subdivision, CD = Draft Plan of Condominium, RH = Rental Housing
// demolition/conversion. Deliberately EXCLUDES Site Plan (SA/SPA) — like Hamilton, it's the
// high-volume low-signal bucket that would turn the flag into wallpaper.
const MATERIAL = new Set(["OZ", "ZR", "ZBL", "OP", "SB", "CD", "RH"]);

const res = await fetch(DUMP);
if (!res.ok) {
  console.error(`❌ dump fetch failed: ${res.status}`);
  process.exit(1);
}
const body = await res.json();
const recs = Array.isArray(body) ? body : (body.rows ?? body.records ?? body.features ?? []);
console.log(`fetched ${recs.length} records`);

// Log distributions so the MATERIAL/YEAR_MIN choices stay auditable.
const byType = {};
const byYear = {};
for (const r of recs) {
  byType[r.APPLICATION_TYPE ?? "∅"] = (byType[r.APPLICATION_TYPE ?? "∅"] ?? 0) + 1;
  const y = String(r.DATE_SUBMITTED ?? "").slice(0, 4);
  byYear[y] = (byYear[y] ?? 0) + 1;
}
console.log("APPLICATION_TYPE distribution:", JSON.stringify(byType));
console.log(
  "recent years:",
  JSON.stringify(Object.fromEntries(Object.entries(byYear).filter(([y]) => y >= "2020").sort())),
);

const features = [];
let keptType = {};
for (const r of recs) {
  const x = Number(r.X);
  const y = Number(r.Y);
  const yr = Number(String(r.DATE_SUBMITTED ?? "").slice(0, 4));
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) continue; // no geocode
  if (!MATERIAL.has(r.APPLICATION_TYPE)) continue;
  if (!(yr >= YEAR_MIN)) continue;
  keptType[r.APPLICATION_TYPE] = (keptType[r.APPLICATION_TYPE] ?? 0) + 1;
  features.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: [x, y] }, // MTM z10 NAD27 — loadGeoData --srid 2019
    properties: {
      APPLICATION_TYPE: r.APPLICATION_TYPE,
      STATUS: r.STATUS ?? null,
      DATE_SUBMITTED: r.DATE_SUBMITTED ?? null,
      DESCRIPTION: r.DESCRIPTION ?? null,
      ADDRESS: [r.STREET_NUM, r.STREET_NAME, r.STREET_TYPE, r.STREET_DIRECTION]
        .filter(Boolean)
        .join(" "),
    },
  });
}
fs.writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
console.log(`kept by type: ${JSON.stringify(keptType)}`);
console.log(`✅ wrote ${features.length} material + recent (>=${YEAR_MIN}) features → ${OUT}`);
