/**
 * harvest-tdsb-catchments.mjs — Toronto DSB (TDSB) PUBLIC attendance boundaries.
 *
 * TDSB publishes no ArcGIS layer; its "Find Your School / By Map" tool serves the
 * REAL attendance-boundary polygons as KML from a DNN endpoint (token-free). Recipe
 * (verified): enumerate schools from the two By-School-Name directory pages →
 * per school ByMap.aspx?focusonschool=<schno> yields its boundary folder+id (or none,
 * for city-wide/alternative schools) → getBounds returns the polygon KML.
 *
 * These are TDSB's own boundaries (official), delivered as KML rather than ArcGIS.
 * Output matches the standard schema so load-school-catchments.ts merges it; the
 * EQAO join attaches the score by school name.
 *
 * Needs a browser User-Agent (the DNN pages return empty otherwise). Token-free.
 * Run: node scripts/admin/harvest-tdsb-catchments.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "school-catchments-tdsb.geojson");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "text/html,application/xml" };
const ROOT = "https://www.tdsb.on.ca";
const BOUNDS = `${ROOT}/DesktopModules/Tdsb.Webteam.Modules.SchoolSearchMap/AjaxResponse.aspx?ad=453dgdjhh218789&exec=getBounds`;
const CONCURRENCY = 8;

async function getText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch(url, { headers: H, signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((s) => setTimeout(s, 700 * (i + 1)));
    }
  }
}

// Minimal KML(polygon) → GeoJSON; handles multiple <Polygon> + inner holes.
function kmlToGeoJSON(kml) {
  const ringCoords = (block) => {
    const m = block.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
    if (!m) return null;
    const pts = m[1]
      .trim()
      .split(/\s+/)
      .map((t) => {
        const [lon, lat] = t.split(",").map(Number);
        return [lon, lat];
      })
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    return pts.length >= 4 ? pts : null;
  };
  const polys = [...kml.matchAll(/<Polygon>([\s\S]*?)<\/Polygon>/gi)]
    .map((pm) => {
      const body = pm[1];
      const outerM = body.match(/<outerBoundaryIs>([\s\S]*?)<\/outerBoundaryIs>/i);
      const outer = outerM ? ringCoords(outerM[1]) : ringCoords(body);
      if (!outer) return null;
      const holes = [...body.matchAll(/<innerBoundaryIs>([\s\S]*?)<\/innerBoundaryIs>/gi)]
        .map((h) => ringCoords(h[1]))
        .filter(Boolean);
      return [outer, ...holes];
    })
    .filter(Boolean);
  if (polys.length === 0) return null;
  return polys.length === 1
    ? { type: "Polygon", coordinates: polys[0] }
    : { type: "MultiPolygon", coordinates: polys };
}

async function enumerate(level) {
  const html = await getText(`${ROOT}/Find-your/School/By-School-Name/${level}`);
  const rows = [];
  for (const m of html.matchAll(/<a\b([^>]*class="SchoolNameLink"[^>]*)>([^<]{2,90})<\/a>/gi)) {
    const sm = m[1].match(/schno[=/](\d+)/i);
    if (sm) rows.push({ schno: sm[1], name: m[2].trim().replace(/\s+/g, " "), level });
  }
  return rows;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

const schools = [...(await enumerate("Elementary")), ...(await enumerate("Secondary"))];
console.log(`TDSB schools enumerated: ${schools.length}`);

const features = [];
let withB = 0,
  noB = 0,
  err = 0;
await pool(schools, CONCURRENCY, async (s) => {
  let bm;
  try {
    bm = await getText(`${ROOT}/Findyour/School/ByMap.aspx?focusonschool=${s.schno}`);
  } catch {
    err++;
    return;
  }
  const fm = bm.match(/folder=([A-Za-z]+)&(?:amp;)?id=(\d+)/i);
  if (!fm) {
    noB++;
    return;
  }
  let kml;
  try {
    kml = await getText(`${BOUNDS}&folder=${fm[1]}&id=${fm[2]}`);
  } catch {
    err++;
    return;
  }
  const geom = kmlToGeoJSON(kml);
  if (!geom) {
    err++;
    return;
  }
  features.push({
    type: "Feature",
    geometry: geom,
    properties: {
      boardCode: "TDSB",
      board: "Toronto DSB",
      system: "public",
      language: "english",
      panel: s.level === "Secondary" ? "secondary" : "elementary",
      year: "2025-2026",
      school_name: s.name,
      source: "https://www.tdsb.on.ca/Find-your/School/By-Map",
    },
  });
  withB++;
  if ((withB + noB) % 50 === 0) console.log(`  … ${withB} boundaries, ${noB} no-catchment, ${err} err`);
});

writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
const byPanel = features.reduce((a, f) => ((a[f.properties.panel] = (a[f.properties.panel] || 0) + 1), a), {});
console.log(`\nTDSB: ${withB} boundaries ${JSON.stringify(byPanel)}, ${noB} no-catchment, ${err} errors → ${OUT.replace(HERE, ".")}`);
