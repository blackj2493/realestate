/**
 * harvest-cecce-catchments.mjs — Conseil des écoles catholiques du Centre-Est (CECCE,
 * French Catholic, Ottawa/Eastern Ontario). Its CartoVista viewer loads attendance
 * boundaries ("secteurs de fréquentation") as static JSON files on the same host.
 *
 * CartoVista compact format: proj = spherical Mercator (R=6,378,137); each feature
 * g.c is a list of rings, each a FLAT array whose first (x,y) is absolute metres and
 * every later pair is a cumulative delta. We decode each ring as its own polygon (a
 * MultiPolygon) — features carry many disjoint pieces — then Mercator→lon/lat.
 * Elementary file carries school names ("Nom"); secondary carries only IDs, so those
 * are labelled by the loader's spatial match. Output matches the standard schema.
 *
 * Run: node scripts/admin/harvest-cecce-catchments.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "school-catchments-cecce.geojson");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CV = "https://app4.ecolecatholique.ca/web/cartovista/map";
const SOURCE = "https://www.ecolecatholique.ca/fr/Dans-Quelle-Ecole-Sinscrire_374";

const FILES = [
  { file: "Secteursdefrequentationelementaires.json", panel: "elementary", nameAttr: "Nom" },
  { file: "Zones_secondaires_2.json", panel: "secondary", nameAttr: null },
];

const R = 6378137;
const mercToLonLat = (x, y) => [
  (x / R) * (180 / Math.PI),
  (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI),
];

/** Decode one CartoVista ring (flat array; first abs, rest cumulative deltas). */
function decodeRing(r) {
  let x = r[0], y = r[1];
  const out = [mercToLonLat(x, y)];
  for (let i = 2; i + 1 < r.length; i += 2) {
    x += r[i];
    y += r[i + 1];
    out.push(mercToLonLat(x, y));
  }
  const f = out[0], l = out[out.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) out.push([f[0], f[1]]); // close ring
  return out;
}

/** Each ring → its own polygon (handles disjoint pieces); always MultiPolygon. */
function decodeGeom(g) {
  if (!g) return null;
  if (g.t === "Polygon") return { type: "MultiPolygon", coordinates: g.c.map((ring) => [decodeRing(ring)]) };
  if (g.t === "MultiPolygon") return { type: "MultiPolygon", coordinates: g.c.map((poly) => poly.map(decodeRing)) };
  return null;
}

const features = [];
for (const spec of FILES) {
  const j = await (await fetch(`${CV}/${spec.file}`, { headers: { "User-Agent": UA } })).json();
  const defs = j.attributeDefinitions || [];
  const nameIdx = spec.nameAttr ? defs.findIndex((d) => (Array.isArray(d) ? d[0] : d.name) === spec.nameAttr) : -1;
  let n = 0;
  for (const feat of j.f || []) {
    const geom = decodeGeom(feat.g);
    if (!geom || geom.coordinates.length === 0) continue;
    features.push({
      type: "Feature",
      geometry: geom,
      properties: {
        boardCode: "CECCE",
        board: "Conseil des écoles catholiques du Centre-Est",
        system: "catholic",
        language: "french",
        panel: spec.panel,
        year: "2024-2025",
        school_name: nameIdx >= 0 ? feat.p[nameIdx] : null,
        source: SOURCE,
      },
    });
    n++;
  }
  console.log(`CECCE ${spec.panel}: ${n} features`);
}

writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
console.log(`CECCE total: ${features.length} → ${OUT.replace(HERE, ".")}`);
