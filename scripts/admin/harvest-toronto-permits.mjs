#!/usr/bin/env node
/**
 * Harvest City of Toronto — Building Permits (CKAN) → geocoded GeoJSON points for the
 * major_construction "Things to Know" flag (src/lib/property/geoDatasets.ts).
 *
 * WHY a harvester (unlike the direct-ArcGIS permit cities): Toronto's building-permit feed has
 * NO coordinates and only an FSA-level postal, so we geocode by an exact address join against
 * Toronto's Address Points open data (~522k points, EPSG:4326) — matching the permit's
 * STREET_NUM|STREET_NAME|STREET_TYPE|STREET_DIRECTION to ADDRESS_NUMBER|LINEAR_NAME|
 * LINEAR_NAME_TYPE|LINEAR_NAME_DIR. Measured match-rate ~97%. (Toronto also REDACTS
 * EST_CONST_COST, so materiality uses permit type + dwelling units + gross floor area, not $.)
 *
 *   node scripts/admin/harvest-toronto-permits.mjs
 *   npx tsx scripts/worker/loadGeoData.ts --dataset major_construction \
 *     --file scripts/admin/permits-toronto.geojson --srid 4326 --source-key toronto_permits
 *
 * The output GeoJSON is gitignored — regenerate it, don't commit.
 * Licence: Open Government Licence – Toronto (commercial use permitted; carried in geo_sources).
 *
 * ANNUAL MAINTENANCE: bump YEAR_MIN so the flag tracks the recent pipeline, not a growing archive.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action";
const AP_RID = "0b3756af-9caf-4f0f-ac28-9c6617adede4"; // Address Points datastore (GeoJSON, 4326)
const OUT = fileURLToPath(new URL("./permits-toronto.geojson", import.meta.url));
const YEAR_MIN = 2024; // active pipeline only (bump annually)

const j = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${r.status} ${u.slice(0, 90)}`);
  return r.json();
};
const norm = (s) => String(s ?? "").toUpperCase().trim().replace(/\s+/g, " ");
const dir = (s) => { const d = norm(s); return d === "NONE" ? "" : d; };
const keyAP = (p) => `${norm(p.ADDRESS_NUMBER)}|${norm(p.LINEAR_NAME)}|${norm(p.LINEAR_NAME_TYPE)}|${dir(p.LINEAR_NAME_DIR)}`;
const keyP = (r) => `${norm(r.STREET_NUM)}|${norm(r.STREET_NAME)}|${norm(r.STREET_TYPE)}|${dir(r.STREET_DIRECTION)}`;

// 1 — index Toronto Address Points (paginated datastore; only the fields we need).
console.log("indexing Toronto address points…");
const map = new Map();
let offset = 0;
for (;;) {
  const r = await j(`${CKAN}/datastore_search?resource_id=${AP_RID}&limit=20000&offset=${offset}&fields=${encodeURIComponent("ADDRESS_NUMBER,LINEAR_NAME,LINEAR_NAME_TYPE,LINEAR_NAME_DIR,geometry")}`);
  const recs = r.result.records ?? [];
  for (const p of recs) { try { map.set(keyAP(p), JSON.parse(p.geometry).coordinates); } catch {} }
  offset += recs.length;
  if (recs.length < 20000) break;
}
console.log(`  indexed ${map.size} address points`);

// 2 — download permits + filter to RECENT + MATERIAL (type + units + GFA; value is redacted).
const permRes = (await j(`${CKAN}/package_show?id=building-permits-active-permits`)).result.resources.find((r) => /json/i.test(r.format) && r.url);
const rows = await j(permRes.url);
console.log(`  fetched ${rows.length} permits`);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const gfa = (r) => num(r.RESIDENTIAL) + num(r.BUSINESS_AND_PERSONAL_SERVICES) + num(r.MERCANTILE) + num(r.INDUSTRIAL) + num(r.INSTITUTIONAL) + num(r.ASSEMBLY);
const yr = (r) => Number(String(r.ISSUED_DATE ?? r.APPLICATION_DATE ?? "").slice(0, 4));
const STATUS_OK = /inspection|permit issued|revision issued|work not started|not started|open|issuance pending/i;
// Structure-level types are auto-material; the mixed "Additions/Alterations" bucket only when it
// adds floor area or a unit (Toronto has no construction value); any >=2-unit creation.
const INHERENT = new Set(["New Building", "New Houses", "Demolition Folder (DM)", "Residential Building Permit", "Non-Residential Building Permit"]);

const features = [];
let material = 0, geocoded = 0;
for (const r of rows) {
  const isAdd = r.PERMIT_TYPE === "Building Additions/Alterations";
  const ok = yr(r) >= YEAR_MIN && STATUS_OK.test(r.STATUS ?? "") &&
    (INHERENT.has(r.PERMIT_TYPE) || num(r.DWELLING_UNITS_CREATED) >= 2 || (isAdd && (gfa(r) >= 50 || num(r.DWELLING_UNITS_CREATED) >= 1)));
  if (!ok) continue;
  material++;
  const coords = map.get(keyP(r));
  if (!coords) continue;
  geocoded++;
  features.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: coords }, // [lng, lat] EPSG:4326
    properties: {
      PERMIT_TYPE: r.PERMIT_TYPE ?? null,
      STRUCTURE_TYPE: r.STRUCTURE_TYPE ?? null,
      STATUS: r.STATUS ?? null,
      ISSUED_DATE: r.ISSUED_DATE ?? null,
      DWELLING_UNITS_CREATED: r.DWELLING_UNITS_CREATED ?? null,
      DESCRIPTION: (r.DESCRIPTION ?? "").slice(0, 200),
      ADDRESS: [r.STREET_NUM, r.STREET_NAME, r.STREET_TYPE, r.STREET_DIRECTION].filter((x) => x && String(x).trim()).join(" "),
    },
  });
}
fs.writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
console.log(`✅ material=${material} · geocoded=${geocoded} (${(100 * geocoded / material).toFixed(1)}%) → ${OUT}`);
