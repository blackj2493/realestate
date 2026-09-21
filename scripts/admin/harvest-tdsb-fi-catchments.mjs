/**
 * harvest-tdsb-fi-catchments.mjs — Toronto DSB EARLY FRENCH IMMERSION zones.
 *
 * TDSB publishes no French Immersion polygon. Its getBounds KML endpoint serves only
 * folder=Elementary, Intermediate and Secondary (14 French spellings all answer HTTP
 * 500 "could not find file"), and its ArcGIS org carries gifted-program boundaries but
 * no FI layer. What it does publish is an address lookup — "Find Your Designated French
 * School" — backed by a DNN StreetGuide module.
 *
 * Reconstructing polygons from labelled addresses would normally mean geocoding tens of
 * thousands of probes and dissolving fuzzy hulls. It does not here, because an FI zone
 * turns out to be the union of whole JK-entry catchments, which we already hold:
 *
 *   416 labelled addresses, 71 FI schools, checked against our regular TDSB zones.
 *   Restricted to JK-entry catchments: 40/40 consistent at >=3 sample points,
 *   16/16 at >=4, 89/90 at >=2 — the single exception being a geocoding error
 *   ("50 May St, Toronto" placed in North York, 10 km from the answer it returned).
 *   Every apparent inconsistency before that restriction was a Middle or Senior
 *   school, whose 6-8 zone spans several JK-entry zones by construction.
 *
 * So we probe ONE address per JK-entry catchment rather than per street: ~375 lookups
 * instead of ~30,000, edges inherited exactly from boundaries we already trust, and a
 * volume that is a reasonable thing to point at a school board once a year.
 *
 * PROBES per catchment is 3, not 1, so the run VERIFIES the union assumption instead of
 * trusting it: a catchment whose probes disagree is reported and dropped, never averaged
 * into a zone. The dissolve itself is the same `dissolve: true` path TCDSB uses.
 *
 * Covers Early French Immersion (JK entry) only — the module serves nothing else.
 * Middle French Immersion and Extended French remain unpublished.
 *
 * Prereqs: scripts/admin/school-catchments-tdsb.geojson (run harvest-tdsb-catchments.mjs
 * first — this reads its JK-entry zones), and NEXT_PUBLIC_MAPBOX_TOKEN for reverse
 * geocoding a point inside each zone to a street the lookup will accept.
 *
 * Run: node scripts/admin/harvest-tdsb-fi-catchments.mjs [--probes=3] [--limit=N]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "dotenv";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
config({ path: [join(ROOT, ".env.local"), join(ROOT, ".env")] });

const IN = join(HERE, "school-catchments-tdsb.geojson");
const OUT = join(HERE, "school-catchments-tdsb-fi.geojson");
const URL_ = "https://www.tdsb.on.ca/Elementary-School/School-Choices/French-Programs/Find-Your-French-School";
const FIELD = "dnn$ctr45502$AddressSearchFr$";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? Number(m.split("=")[1]) : d; };
const PROBES = arg("probes", 3);
const LIMIT = arg("limit", 0);

// ── the lookup ────────────────────────────────────────────────────────────────
// ASP.NET postback: the hidden fields and the session cookie must both be carried.
let COOKIE = "";
let HIDDEN = {};

async function raw(url, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(url, {
        ...opts,
        signal: ctl.signal,
        headers: { "User-Agent": UA, ...(COOKIE ? { Cookie: COOKIE } : {}), ...(opts.headers || {}) },
        redirect: "follow",
      });
      const sc = r.headers.getSetCookie?.() ?? [];
      if (sc.length) COOKIE = sc.map((c) => c.split(";")[0]).join("; ");
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((s) => setTimeout(s, 1200 * (i + 1)));
    } finally { clearTimeout(t); }
  }
}

const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function primeSession() {
  const html = await raw(URL_);
  HIDDEN = Object.fromEntries(
    [...html.matchAll(/<input type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)].map((m) => [m[1], m[2]])
  );
  // The page also ships TDSB's full street index; the lookup rejects anything not on it.
  const i = html.indexOf("var streetname = [");
  const blob = html.slice(i, html.indexOf("];", i));
  return new Set([...blob.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/** Entry school for Early French Immersion at this address, or null.
 *  The school name ends where its own civic address starts, i.e. at the first digit. */
async function frenchSchool(num, street) {
  const body = new URLSearchParams({
    ...HIDDEN,
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    [FIELD + "txtStreetNumber"]: String(num),
    [FIELD + "txtStreet"]: street,
    [FIELD + "btnStreetSearch"]: "Search",
  });
  const html = await raw(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: URL_, Origin: "https://www.tdsb.on.ca" },
    body: body.toString(),
  });
  const j = html.indexOf("The address you entered");
  if (j === -1) return null;
  const t = strip(html.slice(j, j + 3000));
  const k = t.indexOf("Early French Immersion");
  if (k === -1) return null;
  const m = /Entry School\s+(.+?)\s+\d/.exec(t.slice(k, k + 900));
  const name = m?.[1]?.trim();
  return name && name.length > 3 && name.length < 70 ? name : null;
}

// ── geometry helpers ──────────────────────────────────────────────────────────
const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };
const polysOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
function inRing(x, y, r) { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o; } return o; }
function inGeom(x, y, g) {
  for (const poly of polysOf(g)) {
    if (!inRing(x, y, poly[0])) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}
/** Points spread inside the zone's largest ring — a centroid can fall in a hole or in
 *  the sea between two detached pieces, and 45 TDSB zones have detached pieces. */
function samplePoints(g, n) {
  const biggest = polysOf(g).map((p) => ({ p, a: ringArea(p[0]) })).sort((a, b) => b.a - a.a)[0].p;
  const ring = biggest[0];
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const out = [];
  // deterministic lattice, so a re-run probes the same places and results are comparable
  for (let gy = 1; gy <= 7 && out.length < n * 6; gy++)
    for (let gx = 1; gx <= 7 && out.length < n * 6; gx++) {
      const x = minX + ((maxX - minX) * gx) / 8, y = minY + ((maxY - minY) * gy) / 8;
      if (inGeom(x, y, g)) out.push([x, y]);
    }
  // spread the picks across the lattice rather than taking one corner
  const step = Math.max(1, Math.floor(out.length / n));
  return out.filter((_, i) => i % step === 0).slice(0, n);
}

async function reverseGeocode(lng, lat) {
  const u = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&types=address&limit=1&access_token=${TOKEN}`;
  for (let i = 0; i < 3; i++) {
    try {
      // Plain fetch, NOT raw(): raw() stores every Set-Cookie it sees, so routing the
      // geocoder through it overwrote the TDSB ASP.NET session cookie and every
      // subsequent lookup came back empty.
      const r = await fetch(u, { headers: { "User-Agent": UA } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const f = (await r.json()).features?.[0];
      if (!f) return null;
      const p = f.properties ?? {};
      const num = p.context?.address?.address_number ?? /^\d+/.exec(p.name || "")?.[0];
      const st = p.context?.street?.name ?? p.context?.address?.street_name;
      // TDSB keys its index by the six former municipalities, so prefer that over the
      // amalgamated "Toronto" that Mapbox returns as the primary place for some points.
      const place = p.context?.locality?.name || p.context?.place?.name;
      const altPlace = p.context?.place?.alternate?.name;
      if (!num || !st) return null;
      // The MATCHED address, not the probe point. Reverse geocoding snaps to the nearest
      // civic address, which near a zone edge is routinely on the far side of it — the
      // caller re-tests containment with these coordinates before using the answer.
      const [flng, flat] = f.geometry?.coordinates ?? [];
      return { num, street: st, place, altPlace, lng: flng, lat: flat };
    } catch { await new Promise((s) => setTimeout(s, 1000 * (i + 1))); }
  }
  return null;
}

/** Mapbox spells the street type in full; TDSB abbreviates it and rejects anything not
 *  spelled its own way ("Kempford Boulevard" vs "Kempford Blvd, North York"). Counts are
 *  from TDSB's own 10,178-street index. */
const TYPE = new Map(Object.entries({
  avenue: "Ave", road: "Rd", drive: "Dr", crescent: "Cres", street: "St", court: "Crt",
  place: "Pl", boulevard: "Blvd", lane: "Lane", gate: "Gt", square: "Sq", terrace: "Ter",
  way: "Way", trail: "Trl", gardens: "Gdns", circle: "Crcl", mews: "Mews", grove: "Grv",
  heights: "Hts", circuit: "Crct", garden: "Gdn", path: "Path", park: "Pk",
  parkway: "Pkwy", walk: "Walk", hill: "Hill", ridge: "Ridge", mall: "Mall",
}));
const DIR = new Map(Object.entries({ east: "E", west: "W", north: "N", south: "S" }));

/** Rewrite a geocoder street into TDSB's spelling, then index it by municipality. */
function tdsbSpellings(street) {
  const toks = street.trim().split(/\s+/);
  const out = [street];
  const dir = DIR.get(toks[toks.length - 1]?.toLowerCase());
  const body = dir ? toks.slice(0, -1) : toks;
  const abbr = TYPE.get(body[body.length - 1]?.toLowerCase());
  if (abbr) out.push([...body.slice(0, -1), abbr, ...(dir ? [dir] : [])].join(" "));
  if (dir) out.push([...body, dir].join(" "));
  return out;
}

function buildIndex(streets) {
  const byName = new Map();
  for (const s of streets) {
    const [name, muni] = s.split(",");
    const k = name.trim().toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push({ full: s, muni: (muni ?? "").trim().toLowerCase() });
  }
  return byName;
}

/** TDSB spells streets "<Name> <Type>, <former municipality>" and rejects anything else. */
function toTdsbStreet(byName, street, place, altPlace) {
  for (const cand of tdsbSpellings(street)) {
    const hits = byName.get(cand.toLowerCase().replace(/\s+/g, " ").trim());
    if (!hits?.length) continue;
    if (hits.length === 1) return hits[0].full;
    for (const p of [place, altPlace]) {
      const m = p && hits.find((h) => h.muni === p.toLowerCase());
      if (m) return m.full;
    }
    // Ambiguous: the same street name exists in several former municipalities and the
    // geocoder did not tell us which. Guessing the first asks TDSB about a house that
    // can be 10 km away and returns a confident wrong answer, which then reads as a
    // boundary violation. Drop the probe instead.
    return null;
  }
  return null;
}

// ── main ──────────────────────────────────────────────────────────────────────
if (!TOKEN) { console.error("❌ NEXT_PUBLIC_MAPBOX_TOKEN is required (reverse geocoding)"); process.exit(1); }

const index = await primeSession();
const byName = buildIndex(index);
console.log(`TDSB street index: ${index.size} streets, ${byName.size} distinct names`);

const src = JSON.parse(readFileSync(IN, "utf8")).features;
let zones = src.filter((f) => f.properties.panel === "elementary" && f.properties.level === "junior" && f.geometry);
if (!zones.length) { console.error("❌ no JK-entry zones in school-catchments-tdsb.geojson — run harvest-tdsb-catchments.mjs first"); process.exit(1); }
if (LIMIT) zones = zones.slice(0, LIMIT);
console.log(`JK-entry catchments to probe: ${zones.length}  (${PROBES} probes each)\n`);

const byFI = new Map();         // FI school -> member geometries
const disagreed = [];           // catchments whose probes did not agree
const unresolved = [];          // catchments no probe could answer
let probes = 0, snapped = 0, t0 = Date.now();

for (const [i, z] of zones.entries()) {
  const answers = new Map();
  for (const [lng, lat] of samplePoints(z.geometry, PROBES)) {
    const addr = await reverseGeocode(lng, lat);
    if (!addr) continue;
    // Drop a probe whose snapped address left the zone: asking TDSB about a house in
    // the neighbouring catchment and calling the disagreement a boundary violation is
    // how a sound assumption gets thrown away for a measurement error.
    if (Number.isFinite(addr.lng) && !inGeom(addr.lng, addr.lat, z.geometry)) { snapped++; continue; }
    const street = toTdsbStreet(byName, addr.street, addr.place, addr.altPlace);
    if (!street) continue;
    let school = null;
    try { school = await frenchSchool(addr.num, street); probes++; } catch { /* keep the other probes */ }
    if (school) answers.set(school, (answers.get(school) ?? 0) + 1);
  }
  const name = z.properties.school_name;
  if (!answers.size) { unresolved.push(name); }
  else if (answers.size > 1) {
    // The union assumption failed here. Report it; never average it into a zone.
    disagreed.push({ zone: name, answers: Object.fromEntries(answers) });
  } else {
    const fi = [...answers.keys()][0];
    if (!byFI.has(fi)) byFI.set(fi, []);
    byFI.get(fi).push(z.geometry);
  }
  if ((i + 1) % 25 === 0)
    console.log(`  …${i + 1}/${zones.length} zones, ${probes} lookups, ${byFI.size} FI schools, ${disagreed.length} disagreed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const features = [];
for (const [fi, geoms] of byFI) {
  const coords = [];
  for (const g of geoms) coords.push(...polysOf(g));
  features.push({
    type: "Feature",
    geometry: { type: "MultiPolygon", coordinates: coords },
    properties: {
      boardCode: "TDSB", board: "Toronto DSB", system: "public", language: "english",
      panel: "elementary", level: "junior", program: "french_immersion", grades: null,
      year: "2025-2026", school_name: fi,
      source: URL_,
      // members share edges; PostGIS unions them at load so the zone reads as one
      // boundary rather than a stack of feeder outlines (same path TCDSB uses).
      dissolve: true,
      member_zones: geoms.length,
    },
  });
}

writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
const members = features.reduce((a, f) => a + f.properties.member_zones, 0);
console.log(`\n──────── TDSB FRENCH IMMERSION ────────`);
console.log(`zones probed      : ${zones.length}   lookups: ${probes}   (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
console.log(`probes discarded  : ${snapped}  (geocoder snapped the address outside its zone)`);
console.log(`FI zones written  : ${features.length}  from ${members} JK-entry catchments  → ${OUT.replace(HERE, ".")}`);
console.log(`unresolved zones  : ${unresolved.length}${unresolved.length ? " — " + unresolved.slice(0, 8).join(", ") : ""}`);
console.log(`DISAGREED zones   : ${disagreed.length}  (union assumption violated — excluded, not averaged)`);
for (const d of disagreed.slice(0, 15)) console.log(`   ${d.zone}: ${JSON.stringify(d.answers)}`);
if (disagreed.length > zones.length * 0.05)
  console.log(`\n⚠️  over 5% of catchments disagreed. The union assumption may not hold board-wide any more — re-check before loading.`);
