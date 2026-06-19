/**
 * harvest-spsplus-catchments.mjs — boards whose "School Finder" is the proprietary
 * SPS Plus product (api.spsplus.ca, page-embedded api-key). Per-school Regular-Track
 * boundary: GetSchoolList → per school GetSchoolProgramGradeBoundary (RT, gradeRanges[0].low).
 * Covers Peel (PDSB, public) and Hamilton-Wentworth Catholic (HWCDSB). Output matches
 * the standard schema; load-school-catchments.ts merges it.
 *
 * Keys live in the boards' public locator pages (re-scrape if they rotate); no open
 * license — confirm reuse terms with each board.
 * Run: node scripts/admin/harvest-spsplus-catchments.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "school-catchments-spsplus.geojson");
const BASE = "https://api.spsplus.ca/api/v3/Search";
const YEAR = "2025";
const CONCURRENCY = 6;

const TENANTS = [
  { boardCode: "PDSB", board: "Peel DSB", system: "public", key: "00f4b315-24e5-4a05-8894-91148c612e0e", source: "https://www.peelschools.org/school-finder" },
  { boardCode: "HWCDSB", board: "Hamilton-Wentworth Catholic DSB", system: "catholic", key: "d95637ec-729f-567e-ac4d-593651cac23c", source: "https://www.hwcdsb.ca/school_life/school/school_locator_boundaries" },
];

async function jget(url, key, tries = 3) {
  const headers = { "x-api-key": key, "x-api-version": "3.0" };
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch(url, { headers, signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((s) => setTimeout(s, 800 * (i + 1)));
    }
  }
}

async function boundaryFor(school, key) {
  const rt = (school.programTypes || []).find((p) => p.programTypeCode === "RT");
  if (!rt) return null;
  const grade = rt.gradeRanges?.[0]?.low;
  if (grade == null) return null;
  const url =
    `${BASE}/GetSchoolProgramGradeBoundary?schoolId=${school.schoolId}` +
    `&programTypeCode=RT&gradeCode=${encodeURIComponent(grade)}&schoolYear=${YEAR}`;
  let res;
  try {
    res = await jget(url, key);
  } catch {
    return null;
  }
  const raw = res?.boundaryGeoJson;
  if (!raw) return null;
  let geom;
  try {
    geom = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) return null;
  return geom;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

const features = [];
for (const tenant of TENANTS) {
  const schools = await jget(`${BASE}/GetSchoolList?schoolYear=${YEAR}`, tenant.key);
  console.log(`${tenant.boardCode}: ${schools.length} schools`);
  let ok = 0, skip = 0;
  await pool(schools, CONCURRENCY, async (s) => {
    const geom = await boundaryFor(s, tenant.key);
    if (!geom) { skip++; return; }
    features.push({
      type: "Feature",
      geometry: geom,
      properties: {
        boardCode: tenant.boardCode, board: tenant.board, system: tenant.system, language: "english",
        panel: s.schoolTypeName === "Secondary" ? "secondary" : "elementary",
        year: "2025-2026", school_name: s.schoolName, source: tenant.source,
      },
    });
    ok++;
  });
  console.log(`  ${tenant.boardCode}: ${ok} boundaries, ${skip} skipped`);
}

writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
const byBoard = features.reduce((a, f) => ((a[f.properties.boardCode] = (a[f.properties.boardCode] || 0) + 1), a), {});
console.log(`\nSPS Plus total: ${features.length} ${JSON.stringify(byBoard)} → ${OUT.replace(HERE, ".")}`);
