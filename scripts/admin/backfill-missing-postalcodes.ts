/**
 * Shadow MLS — Backfill / Repair Missing Postal Codes (LDU → FSA → fallback)
 *
 * Listings whose postal code is absent from our libraries get dumped at the
 * Toronto-center geocoding fallback [43.6532, -79.3832] (see resolveLocation.ts).
 * Most are NEW-development postal codes (LDUs starting with 0) the snapshot
 * libraries predate.
 *
 * For every such code this tool tries, in order:
 *   1. EXACT postal code (LDU)  → write data/postal-codes.json   (precise)
 *   2. FSA prefix (first 3)     → write data/fsa-centroids.json  (neighbourhood)
 *   3. neither resolvable       → leave the doc at the honest Toronto fallback
 * then patches the affected docs' `location` in Typesense. Adding the FSA centroid
 * also makes getCoordinates() (tier 3) resolve EVERY future listing in that FSA —
 * the durable rule: prefer FSA over downtown Toronto.
 *
 * GEOCODER: Google ONLY, strict (status OK, no partial_match, type=postal_code,
 * inside the TRREB catchment box). Mapbox's postcode geocoder returns garbage
 * defaults (PEI/Yukon) for unknown codes and must NOT be used.
 *
 * IDEMPOTENT: docs found by PostalCode (not location); libraries rebuilt from a
 * clean baseline so prior runs leave no residue.
 *
 * Usage:
 *   npx.cmd tsx --env-file=.env scripts/admin/backfill-missing-postalcodes.ts            # dry-run
 *   npx.cmd tsx --env-file=.env scripts/admin/backfill-missing-postalcodes.ts --apply    # write
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import Typesense from 'typesense';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const APPLY = process.argv.includes('--apply');
const FALLBACK_LAT = 43.6532;
const FALLBACK_LNG = -79.3832;
const FALLBACK_RADIUS_KM = 0.03;
const POSTAL_JSON = path.join(process.cwd(), 'data', 'postal-codes.json');
const POSTAL_JSON_REL = 'data/postal-codes.json';
const FSA_JSON = path.join(process.cwd(), 'data', 'fsa-centroids.json');
const FSA_JSON_REL = 'data/fsa-centroids.json';
const CITY_JSON = path.join(process.cwd(), 'data', 'city-centroids.json');
const CITY_JSON_REL = 'data/city-centroids.json';
const GEOCODE_DELAY_MS = 110;

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_COLLECTION = 'properties';
const TYPESENSE_KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';

const CA_POSTAL = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/;
const CA_FSA = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]$/;
const FAKE_POSTALS = new Set(['A1A1A1', 'X0X0X0']);

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: TYPESENSE_KEY,
  connectionTimeoutSeconds: 30,
});

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const normalize = (pc: string): string => (pc || '').toUpperCase().replace(/\s/g, '');
const spaced = (norm: string): string => `${norm.slice(0, 3)} ${norm.slice(3)}`;
// Sanity box for the TRREB catchment (rejects out-of-province typos like T1P→Calgary).
const inCatchment = (lat: number, lng: number) => lat >= 41.5 && lat <= 57 && lng >= -95.5 && lng <= -74;

// Google geocode for a FULL postal code (LDU) only — strict. Google's API has NO
// FSA-level lookup (components=postal_code:M2B → ZERO_RESULTS; address form matches
// "Canada" and returns the country centroid), so FSA centroids are derived from our
// own LDU library instead (see fsaFromLib in main).
async function geocodeLdu(code: string): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?components=postal_code:${encodeURIComponent(code)}|country:CA&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  const j: any = await res.json();
  if (j?.status !== 'OK') return null;
  const r = j.results?.[0];
  if (!r || r.partial_match === true) return null;
  if (!Array.isArray(r.types) || !r.types.includes('postal_code')) return null;
  const loc = r.geometry?.location;
  if (!loc || !inCatchment(loc.lat, loc.lng)) return null;
  return { lat: loc.lat, lng: loc.lng };
}

function readJsonViaGit<T>(relPath: string): T {
  const raw = execSync(`git show HEAD:${relPath}`, { maxBuffer: 512 * 1024 * 1024 }).toString('utf-8');
  return JSON.parse(raw) as T;
}

// Read a (possibly untracked/new) JSON file from disk; [] if absent or empty.
function readJsonSafe<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(file, 'utf-8').trim();
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

async function findDocsByPostal(norm: string): Promise<{ id: string; city: string }[]> {
  const candidates = [spaced(norm), norm].map(v => `\`${v}\``).join(', ');
  try {
    const res: any = await ts.collections(TYPESENSE_COLLECTION).documents().search({
      q: '*', query_by: 'PropertyType',
      filter_by: `PostalCode:=[${candidates}]`,
      include_fields: 'id,City', per_page: 250,
    } as any);
    return (res.hits || []).map((h: any) => ({ id: h.document.id, city: h.document.City || '' }));
  } catch { return []; }
}

// Google geocode for a municipality/locality (last-resort tier). Constrained to
// Ontario; accepts locality-grade results only (rejects the whole-province centroid
// returned for junk like "Out of Area").
const CITY_TYPES_OK = new Set(['locality', 'administrative_area_level_3', 'neighborhood', 'sublocality', 'postal_town']);
async function geocodeCity(city: string): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_KEY || !city.trim()) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&components=country:CA|administrative_area:ON&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  const j: any = await res.json();
  if (j?.status !== 'OK') return null;
  const r = j.results?.[0];
  const types: string[] = Array.isArray(r?.types) ? r.types : [];
  if (!types.some(t => CITY_TYPES_OK.has(t))) return null;
  const loc = r.geometry?.location;
  if (!loc || !inCatchment(loc.lat, loc.lng)) return null;
  return { lat: loc.lat, lng: loc.lng };
}

async function main() {
  console.log(`\n📍 Backfill Missing Postal Codes — LDU→FSA→fallback  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(64));
  if (!TYPESENSE_KEY) { console.error('❌ TYPESENSE_ADMIN_API_KEY not set'); process.exit(1); }
  if (!GOOGLE_KEY) { console.error('❌ NEXT_PUBLIC_GOOGLE_MAPS_API_KEY not set'); process.exit(1); }

  // Clean baselines from git HEAD.
  const headPostal = readJsonViaGit<{ postalCode: string; lat: number; lng: number }[]>(POSTAL_JSON_REL);
  const headFsa = readJsonViaGit<{ fsa: string; lat: number; lng: number }[]>(FSA_JSON_REL);
  const postalExact = new Set(headPostal.map(e => e.postalCode));
  const postalNorm = new Set(headPostal.map(e => normalize(e.postalCode)));
  const fsaExisting = new Set(headFsa.map(e => e.fsa));
  const baseCity = readJsonSafe<{ city: string; lat: number; lng: number }[]>(CITY_JSON, []);
  const cityExisting = new Set(baseCity.map(e => e.city.trim().toUpperCase()));
  console.log(`Baselines: ${headPostal.length.toLocaleString()} postal codes, ${headFsa.length} FSA centroids, ${baseCity.length} city centroids`);

  // Derive FSA centroids from the LDU library (mean of all LDUs sharing the FSA).
  // Google has no FSA-level geocode, and the library is the most accurate source.
  const fsaAgg = new Map<string, { sumLat: number; sumLng: number; n: number }>();
  for (const e of headPostal) {
    const f = normalize(e.postalCode).slice(0, 3);
    if (!CA_FSA.test(f)) continue;
    const a = fsaAgg.get(f) || { sumLat: 0, sumLng: 0, n: 0 };
    a.sumLat += e.lat; a.sumLng += e.lng; a.n++;
    fsaAgg.set(f, a);
  }
  const fsaFromLib = (fsa: string): { lat: number; lng: number } | null => {
    const a = fsaAgg.get(fsa);
    if (!a || a.n === 0) return null;
    const lat = a.sumLat / a.n, lng = a.sumLng / a.n;
    return inCatchment(lat, lng) ? { lat, lng } : null;
  };

  // Target codes = (codes a prior run added = current − HEAD) ∪ (fixable codes still on the fallback point).
  const targets = new Set<string>();
  if (fs.existsSync(POSTAL_JSON)) {
    const cur = JSON.parse(fs.readFileSync(POSTAL_JSON, 'utf-8')) as { postalCode: string }[];
    for (const e of cur) {
      const n = normalize(e.postalCode);
      if (!postalNorm.has(n) && CA_POSTAL.test(n) && !FAKE_POSTALS.has(n)) targets.add(n);
    }
  }
  const fb: any = await ts.collections(TYPESENSE_COLLECTION).documents().search({
    q: '*', query_by: 'PropertyType',
    filter_by: `location:(${FALLBACK_LAT}, ${FALLBACK_LNG}, ${FALLBACK_RADIUS_KM} km)`,
    include_fields: 'id,PostalCode', per_page: 250,
  } as any);
  let junkAtFallback = 0;
  for (const h of (fb.hits || [])) {
    const n = normalize(h.document.PostalCode);
    if (CA_POSTAL.test(n) && !FAKE_POSTALS.has(n)) targets.add(n); else junkAtFallback++;
  }
  console.log(`Targets: ${targets.size} codes | junk at fallback (unfixable): ${junkAtFallback} docs\n`);

  const lduAdditions: { postalCode: string; lat: number; lng: number }[] = [];
  const fsaAdditions = new Map<string, { lat: number; lng: number }>(); // dedup per FSA
  const fsaTried = new Map<string, { lat: number; lng: number } | null>(); // FSA cache
  const cityAdditions = new Map<string, { city: string; lat: number; lng: number }>(); // key: UPPER(city)
  const cityTried = new Map<string, { lat: number; lng: number } | null>(); // city geocode cache
  const docUpdates: { id: string; location: [number, number] }[] = [];
  let nLdu = 0, nFsa = 0, nCityDocs = 0, nFallback = 0;

  for (const norm of [...targets].sort()) {
    const docs = await findDocsByPostal(norm);
    const ids = docs.map(d => d.id);

    // Tier 1: exact LDU (Google)
    const ldu = await geocodeLdu(norm);
    await sleep(GEOCODE_DELAY_MS);
    if (ldu) {
      lduAdditions.push({ postalCode: norm, lat: ldu.lat, lng: ldu.lng });
      for (const id of ids) docUpdates.push({ id, location: [ldu.lat, ldu.lng] });
      nLdu++;
      console.log(`  ✅ LDU ${norm} → ${ldu.lat.toFixed(5)},${ldu.lng.toFixed(5)} (${ids.length} docs)`);
      continue;
    }

    // Tier 2: FSA centroid (derived from the LDU library)
    const fsa = norm.slice(0, 3);
    let fsaCoord = fsaTried.get(fsa);
    if (fsaCoord === undefined) {
      fsaCoord = CA_FSA.test(fsa) ? fsaFromLib(fsa) : null;
      fsaTried.set(fsa, fsaCoord);
    }
    if (fsaCoord) {
      if (!fsaExisting.has(fsa) && !fsaAdditions.has(fsa)) fsaAdditions.set(fsa, fsaCoord);
      for (const id of ids) docUpdates.push({ id, location: [fsaCoord.lat, fsaCoord.lng] });
      nFsa++;
      console.log(`  🟡 FSA ${norm} → ${fsa} ${fsaCoord.lat.toFixed(5)},${fsaCoord.lng.toFixed(5)} (${ids.length} docs)`);
      continue;
    }

    // Tier 3: city centre (per doc — invalid postal codes still land in the right city)
    for (const d of docs) {
      const key = d.city.trim().toUpperCase();
      let cityCoord: { lat: number; lng: number } | null | undefined = key ? cityTried.get(key) : null;
      if (key && cityCoord === undefined) {
        cityCoord = await geocodeCity(d.city);
        cityTried.set(key, cityCoord);
        await sleep(GEOCODE_DELAY_MS);
      }
      if (cityCoord) {
        if (!cityExisting.has(key) && !cityAdditions.has(key)) cityAdditions.set(key, { city: d.city.trim(), lat: cityCoord.lat, lng: cityCoord.lng });
        docUpdates.push({ id: d.id, location: [cityCoord.lat, cityCoord.lng] });
        nCityDocs++;
        console.log(`  🏙  CITY ${norm} "${d.city}" → ${cityCoord.lat.toFixed(4)},${cityCoord.lng.toFixed(4)}`);
      } else {
        docUpdates.push({ id: d.id, location: [FALLBACK_LAT, FALLBACK_LNG] });
        nFallback++;
        console.log(`  ❌ ${norm} "${d.city}" → unresolvable → fallback`);
      }
    }
  }

  console.log(`\nResolved: ${nLdu} LDU codes, ${nFsa} FSA codes (+${fsaAdditions.size} FSA centroids), ${nCityDocs} docs to city centre (+${cityAdditions.size} city centroids), ${nFallback} docs to Toronto fallback.`);
  console.log(`Doc updates: ${docUpdates.length}`);

  if (!APPLY) {
    console.log(`\n💡 Dry-run. Re-run with --apply to write ${lduAdditions.length} LDUs + ${fsaAdditions.size} FSAs + ${cityAdditions.size} city centroids and patch ${docUpdates.length} docs.`);
    return;
  }

  // Rebuild postal-codes.json from HEAD + LDU additions.
  console.log(`\n💾 Rebuilding ${POSTAL_JSON_REL} (HEAD + ${lduAdditions.length} LDUs)...`);
  const outPostal = headPostal.slice();
  let addedLdu = 0;
  for (const e of lduAdditions) { if (!postalExact.has(e.postalCode)) { outPostal.push(e); postalExact.add(e.postalCode); addedLdu++; } }
  fs.writeFileSync(POSTAL_JSON + '.tmp', JSON.stringify(outPostal));
  fs.renameSync(POSTAL_JSON + '.tmp', POSTAL_JSON);
  console.log(`   ${POSTAL_JSON_REL}: ${outPostal.length.toLocaleString()} (+${addedLdu})`);

  // Rebuild fsa-centroids.json from HEAD + FSA additions.
  console.log(`💾 Rebuilding ${FSA_JSON_REL} (HEAD + ${fsaAdditions.size} FSAs)...`);
  const outFsa = headFsa.slice();
  let addedFsa = 0;
  for (const [fsa, c] of fsaAdditions) { if (!fsaExisting.has(fsa)) { outFsa.push({ fsa, lat: c.lat, lng: c.lng }); fsaExisting.add(fsa); addedFsa++; } }
  fs.writeFileSync(FSA_JSON + '.tmp', JSON.stringify(outFsa));
  fs.renameSync(FSA_JSON + '.tmp', FSA_JSON);
  console.log(`   ${FSA_JSON_REL}: ${outFsa.length} (+${addedFsa})`);

  // Append new city centroids (keyed by raw TRREB City string).
  console.log(`💾 Updating ${CITY_JSON_REL} (+${cityAdditions.size} cities)...`);
  const outCity = baseCity.slice();
  let addedCity = 0;
  for (const [key, c] of cityAdditions) { if (!cityExisting.has(key)) { outCity.push({ city: c.city, lat: c.lat, lng: c.lng }); cityExisting.add(key); addedCity++; } }
  outCity.sort((a, b) => a.city.localeCompare(b.city));
  fs.writeFileSync(CITY_JSON + '.tmp', JSON.stringify(outCity, null, 0));
  fs.renameSync(CITY_JSON + '.tmp', CITY_JSON);
  console.log(`   ${CITY_JSON_REL}: ${outCity.length} (+${addedCity})`);

  if (docUpdates.length > 0) {
    console.log(`\n🔄 Patching ${docUpdates.length} docs in Typesense...`);
    const importRes = await ts.collections(TYPESENSE_COLLECTION).documents().import(docUpdates, { action: 'update' });
    const ok = Array.isArray(importRes) ? importRes.filter((x: any) => x.success).length : docUpdates.length;
    console.log(`   Updated ${ok}/${docUpdates.length} docs.`);
  }

  console.log(`\n✅ Done. +${addedLdu} LDUs, +${addedFsa} FSA centroids, +${addedCity} city centroids. ${nFallback} docs remain at Toronto fallback (junk/foreign/out-of-province).`);
  console.log('   Review & commit data/postal-codes.json + data/fsa-centroids.json + data/city-centroids.json.');
}

main().catch(e => { console.error('\n❌ Crashed:', e?.message || e); process.exit(1); });
