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
 * Two axes come out of the ByMap page, and both matter:
 *   - every folder/id pair, because a catchment can be several detached pieces;
 *   - the FOLDER itself (Elementary = JK entry, Intermediate = 6-8), because TDSB runs
 *     a separate middle/senior school whose zone overlays several JK-entry zones.
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
  err = 0,
  kmlPieces = 0;
await pool(schools, CONCURRENCY, async (s) => {
  let bm;
  try {
    bm = await getText(`${ROOT}/Findyour/School/ByMap.aspx?focusonschool=${s.schno}`);
  } catch {
    err++;
    return;
  }
  // EVERY folder/id on the page, not just the first. A catchment can be several
  // detached pieces, stacked on TDSB's own map as id1/id2/id3 — Baycrest has three.
  // Matching once dropped 66 of the board's 558 pieces across 45 schools, so those
  // homes sat outside their own school's zone on our map.
  const pairs = [
    ...new Map(
      [...bm.matchAll(/folder=([A-Za-z]+)&(?:amp;)?id=(\d+)/gi)].map((m) => [`${m[1]}|${m[2]}`, { folder: m[1], id: m[2] }])
    ).values(),
  ];
  if (!pairs.length) {
    noB++;
    return;
  }

  const polys = [];
  kmlPieces += pairs.length;
  for (const p of pairs) {
    let kml;
    try {
      kml = await getText(`${BOUNDS}&folder=${p.folder}&id=${p.id}`);
    } catch {
      err++;
      continue;
    }
    const g = kmlToGeoJSON(kml);
    if (!g) { err++; continue; }
    if (g.type === "Polygon") polys.push(g.coordinates);
    else polys.push(...g.coordinates);
  }
  if (!polys.length) {
    err++;
    return;
  }
  const geom = polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };

  // The FOLDER is the grade band, and it is what stops the overlay stacking two
  // boundaries on one address. TDSB splits elementary into a JK-entry school and a
  // separate 6-8 middle/senior school whose zone spans several of them: 155 of 411
  // sampled Toronto addresses fell inside two of our 'elementary' zones because both
  // were filed under the directory's level. Verified 2026-09-21 that no school carries
  // both folders, and that all 56 Intermediate schools are named Middle/Senior/Sr.
  const folder = pairs[0].folder;
  const panel = folder === "Secondary" || s.level === "Secondary" ? "secondary" : "elementary";
  const level = panel === "secondary" ? null : folder === "Intermediate" ? "intermediate" : "junior";

  features.push({
    type: "Feature",
    geometry: geom,
    properties: {
      boardCode: "TDSB",
      board: "Toronto DSB",
      system: "public",
      language: "english",
      panel,
      level,
      parts: polys.length,
      // getBounds serves only folder=Elementary and folder=Intermediate — no French
      // Immersion anywhere on this path (verified 2026-09-21), so every row is regular.
      // The map states that gap instead of drawing a circle in its place.
      program: "regular",
      grades: null,
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
const byLevel = features.reduce((a, f) => ((a[f.properties.level ?? "n/a"] = (a[f.properties.level ?? "n/a"] || 0) + 1), a), {});
const polys = features.reduce((a, f) => a + f.properties.parts, 0);
console.log(`\nTDSB: ${withB} boundaries ${JSON.stringify(byPanel)} level=${JSON.stringify(byLevel)}`);
console.log(`      ${kmlPieces} KML pieces fetched (v1 fetched one per school, so it dropped ${kmlPieces - withB}), ${polys} polygons total`);
console.log(`      ${noB} no-catchment, ${err} errors → ${OUT.replace(HERE, ".")}`);
