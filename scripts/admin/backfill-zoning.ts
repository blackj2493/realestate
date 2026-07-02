/**
 * Backfill — stamp each Toronto listing with its zoning by point-in-polygon.
 *
 * Phase 1, first source (Toronto). Fetches the open Toronto zoning polygons (OGL-Toronto),
 * builds a dep-free grid spatial index, tests every Toronto listing's [lat,lng] against them,
 * and writes zoning_designation (code) + zoning_desc (plain-language) + zoning_source ("toronto")
 * to Typesense. --apply also runs the schema alter (add-zoning-field) so the code is filterable.
 *
 * Dry-run by default: reports match rate + samples and writes NOTHING.
 *
 *   npx tsx --env-file=.env scripts/admin/backfill-zoning.ts           # dry-run
 *   npx tsx --env-file=.env scripts/admin/backfill-zoning.ts --apply   # write to prod
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import Typesense from 'typesense';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';

const APPLY = process.argv.includes('--apply');
const HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
// Reads the GeoJSON produced by harvest-toronto-zoning.mjs (harvest → file → backfill).
const GEOJSON = process.argv.find((a) => a.endsWith('.geojson')) || 'scripts/admin/zoning-toronto.geojson';
const SOURCE_KEY = 'toronto';
const CHUNK = 2000;
// Near-miss snap: a listing point on a road right-of-way / centreline sits INSIDE no zone
// polygon (roads aren't zoned), but the abutting parcel a few metres away is. When containment
// misses, snap to the nearest zone within SNAP_M metres. Override with --snap=<metres>.
const SNAP_ARG = process.argv.find((a) => a.startsWith('--snap='));
const SNAP_M = SNAP_ARG ? Math.max(0, Number(SNAP_ARG.split('=')[1]) || 0) : 30;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;
const ts = new Typesense.Client({ nodes: [{ host: HOST, port: 443, protocol: 'https' }], apiKey: KEY, connectionTimeoutSeconds: 120 });

// Toronto By-law 569-2013 base zones → plain language (only confident mappings; coarse fallback).
const TORONTO_ZONES: Record<string, string> = {
  R: 'Residential', RD: 'Residential Detached', RS: 'Residential Semi-Detached',
  RT: 'Residential Townhouse', RM: 'Residential Multiple Dwelling', RA: 'Residential Apartment',
  CR: 'Commercial Residential', E: 'Employment (Industrial)', I: 'Institutional',
  O: 'Open Space', UT: 'Utility & Transportation',
};
function zoneName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (TORONTO_ZONES[code]) return TORONTO_ZONES[code];
  const c = code[0];
  return c === 'R' ? 'Residential' : c === 'C' ? 'Commercial Residential' : c === 'E' ? 'Employment'
    : c === 'I' ? 'Institutional' : c === 'O' ? 'Open Space' : undefined;
}

// ── Geometry (GeoJSON [lng,lat]) — dep-free point-in-polygon ───────────────
type Ring = number[][];
function ringContains(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyContains(x: number, y: number, rings: Ring[]): boolean {
  if (!rings.length || !ringContains(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (ringContains(x, y, rings[k])) return false; // hole
  return true;
}
function geomContains(x: number, y: number, geom: AnyObj): boolean {
  if (!geom) return false;
  if (geom.type === 'Polygon') return polyContains(x, y, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some((p: Ring[]) => polyContains(x, y, p));
  return false;
}
// ── Metric point→polygon distance (for the near-miss snap) ─────────────────
// Local equirectangular projection around the query point: convert lng/lat deltas to
// metres (sx scales lng by cos(lat)), then measure the point→edge distance in that plane.
const M_PER_DEG = 111320;
function ringMinDist2(px: number, py: number, ring: Ring, sx: number, sy: number): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - px) * sx, ay = (ring[j][1] - py) * sy;
    const bx = (ring[i][0] - px) * sx, by = (ring[i][1] - py) * sy;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * dx, cy = ay + t * dy;
    const d2 = cx * cx + cy * cy;
    if (d2 < best) best = d2;
  }
  return best;
}
function geomMinDistM(px: number, py: number, geom: AnyObj): number {
  const sy = M_PER_DEG, sx = M_PER_DEG * Math.cos((py * Math.PI) / 180);
  let best = Infinity;
  const polys: Ring[][] = geom?.type === 'Polygon' ? [geom.coordinates]
    : geom?.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) for (const ring of poly) {
    const d2 = ringMinDist2(px, py, ring, sx, sy);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}
function bboxOf(geom: AnyObj): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (r: Ring) => { for (const [x, y] of r) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
  if (geom.type === 'Polygon') geom.coordinates.forEach(eat);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach((p: Ring[]) => p.forEach(eat));
  return [minX, minY, maxX, maxY];
}

async function readPolygons() {
  const fc: AnyObj = JSON.parse(await readFile(GEOJSON, 'utf8'));
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error(`not a FeatureCollection: ${GEOJSON}`);
  const feats: { code: string; geom: AnyObj; box: [number, number, number, number] }[] = [];
  for (const f of fc.features) if (f.geometry) feats.push({ code: f.properties?.ZN_ZONE, geom: f.geometry, box: bboxOf(f.geometry) });
  return feats;
}

const GRID = 128;
function buildGrid(feats: AnyObj[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of feats) { const [a, b, c, d] = f.box; if (a < minX) minX = a; if (b < minY) minY = b; if (c > maxX) maxX = c; if (d > maxY) maxY = d; }
  const cw = (maxX - minX) / GRID || 1, ch = (maxY - minY) / GRID || 1;
  const clamp = (v: number) => Math.max(0, Math.min(GRID - 1, v));
  const cellXY = (x: number, y: number): [number, number] => [clamp(Math.floor((x - minX) / cw)), clamp(Math.floor((y - minY) / ch))];
  const cell = (x: number, y: number) => { const [cx, cy] = cellXY(x, y); return `${cx},${cy}`; };
  const grid = new Map<string, number[]>();
  feats.forEach((f, i) => {
    const [a, b, c, d] = f.box;
    for (let cx = Math.floor((a - minX) / cw); cx <= Math.floor((c - minX) / cw); cx++)
      for (let cy = Math.floor((b - minY) / ch); cy <= Math.floor((d - minY) / ch); cy++) {
        const key = `${Math.max(0, Math.min(GRID - 1, cx))},${Math.max(0, Math.min(GRID - 1, cy))}`;
        (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
      }
  });
  return { grid, cell, cellXY };
}

async function main() {
  console.log(`\n🗺️  Backfill Toronto zoning  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(56));
  if (!KEY) { console.error('❌ TYPESENSE_ADMIN_API_KEY not set'); process.exit(1); }

  console.log(`Reading Toronto zoning polygons from ${GEOJSON}…`);
  const feats = await readPolygons();
  const { grid, cell, cellXY } = buildGrid(feats);
  console.log(`   ${feats.length} polygons indexed.  (near-miss snap ≤ ${SNAP_M}m)`);

  console.log('Exporting Toronto listings (id, location, City)…');
  const raw = (await ts.collections(COLLECTION).documents().export({ include_fields: 'id,location,City' })) as unknown as string;
  const lines = raw.split('\n').filter((l) => l.trim());
  const toronto = lines.map((l) => JSON.parse(l)).filter((d: AnyObj) => typeof d.City === 'string' && d.City.startsWith('Toronto'));

  let withLoc = 0, matched = 0, exact = 0, snapped = 0;
  const zoneHits: Record<string, number> = {};
  const updates: AnyObj[] = [];
  const samples: string[] = [];
  for (const d of toronto) {
    const loc = d.location;
    if (!Array.isArray(loc) || loc.length !== 2 || (!loc[0] && !loc[1])) continue;
    withLoc++;
    const x = loc[1], y = loc[0]; // location is [lat,lng] → point [lng,lat]
    let hit: AnyObj = null;
    let viaSnap = false;
    // 1) exact containment in the point's own grid cell
    for (const idx of grid.get(cell(x, y)) ?? []) if (geomContains(x, y, feats[idx].geom)) { hit = feats[idx]; break; }
    // 2) near-miss: nearest zone across the 3×3 cell neighbourhood, within SNAP_M metres
    if (!hit?.code && SNAP_M > 0) {
      const [cx, cy] = cellXY(x, y);
      const seen = new Set<number>();
      let bestD = Infinity, best: AnyObj = null;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const idx of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (seen.has(idx)) continue; seen.add(idx);
          const f = feats[idx];
          if (!f.code) continue;
          const dist = geomMinDistM(x, y, f.geom);
          if (dist < bestD) { bestD = dist; best = f; }
        }
      }
      if (best && bestD <= SNAP_M) { hit = best; viaSnap = true; }
    }
    if (!hit?.code) continue;
    matched++;
    if (viaSnap) snapped++; else exact++;
    zoneHits[hit.code] = (zoneHits[hit.code] ?? 0) + 1;
    const u: AnyObj = { id: d.id, zoning_designation: hit.code, zoning_source: SOURCE_KEY };
    const name = zoneName(hit.code);
    if (name) u.zoning_desc = name;
    updates.push(u);
    if (samples.length < 6) samples.push(`${d.id}: ${hit.code}${name ? ` (${name})` : ''}${viaSnap ? ' ~snap' : ''}`);
  }

  const rate = withLoc ? ((matched / withLoc) * 100).toFixed(1) : '0';
  console.log(`\nToronto listings: ${toronto.length.toLocaleString()}  |  with location: ${withLoc.toLocaleString()}  |  matched a zone: ${matched.toLocaleString()} (${rate}%)  [exact: ${exact.toLocaleString()}, snapped: ${snapped.toLocaleString()}]`);
  const topZones = Object.entries(zoneHits).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log('top zones:', topZones.map(([z, n]) => `${z}:${n}`).join(', '));
  console.log('samples:', samples.join(' | '));

  if (!APPLY) {
    console.log(`\nDry-run. Would patch ${updates.length.toLocaleString()} docs. Re-run with --apply to write + declare the field.`);
    return;
  }

  // Declare zoning_designation (indexed) so the code is filterable, then patch values.
  const coll: AnyObj = await ts.collections(COLLECTION).retrieve();
  if (!(coll.fields || []).some((f: AnyObj) => f.name === 'zoning_designation')) {
    const def = (typesenseSchema.fields as AnyObj[]).find((f) => f.name === 'zoning_designation');
    await ts.collections(COLLECTION).update({ fields: [def] } as AnyObj);
    console.log('   ✅ Declared zoning_designation.');
  }
  let done = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = updates.slice(i, i + CHUNK).map((u) => JSON.stringify(u)).join('\n');
    await ts.collections(COLLECTION).documents().import(batch, { action: 'update' });
    done += Math.min(CHUNK, updates.length - i);
    console.log(`   …patched ${done.toLocaleString()}/${updates.length.toLocaleString()}`);
  }
  console.log('\n✅ Toronto zoning backfilled.');
}

main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
