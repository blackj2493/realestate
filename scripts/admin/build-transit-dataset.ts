/**
 * Add GTA passenger-transit stations to data/gta-amenities.json.
 *
 * Source: Overture Maps `places`, CDLA-Permissive 2.0 (attribution: "© OpenStreetMap
 * contributors, © Overture Maps Foundation"). Pull the raw candidates first:
 *
 *   python scripts/admin/overture_amenities.py --transit   # -> data/_geo_src/overture-transit-raw.json
 *   npx.cmd tsx scripts/admin/build-transit-dataset.ts     # -> merged into data/gta-amenities.json
 *
 * MERGE, DO NOT REBUILD. This script rewrites ONLY the `transit` rows and copies every
 * grocery/recreation row through byte-for-byte. That is not tidiness — Overture keeps just
 * the two most recent releases, and 2026-05-20.0, which produced the committed
 * grocery/recreation rows, has been deleted. They cannot be regenerated, and re-deriving
 * them from a newer release would move every listing's NearestGroceryKm / NearestRecCentreKm
 * without anyone asking for it. Transit is additive and safe to rebuild at will.
 *
 * Deterministic classification, no AI (CLAUDE.md §4).
 */
import * as fs from 'fs';
import * as path from 'path';

const RAW_FILE = path.join(process.cwd(), 'data', '_geo_src', 'overture-transit-raw.json');
const OUT_FILE = path.join(process.cwd(), 'data', 'gta-amenities.json');

interface RawPOI {
  id: string;
  name: string | null;
  category: string | null;
  lat: number | null;
  lng: number | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
}

interface Amenity {
  id: string;
  name: string;
  type: string;
  category: string;
  lat: number;
  lng: number;
  address: string;
}

/**
 * A name must carry one of these to be a station a person would name as a destination.
 * The positive test does the heavy lifting: `bus_station` is ~70% individual stops and
 * depots, and no blocklist reliably separates "Ed Standing Here" or "Be Fit Now Studios"
 * — both really are filed under transit categories — from a real terminal.
 */
const STATION_WORD = /\bGO\b|\bstation\b|\bterminal\b|vivastation|\bsubway\b|\bgare\b/i;

/**
 * Rail plumbing and businesses that pass STATION_WORD anyway. Every entry earns its place
 * from a live row: GO Transit Willowbrook Yard, CN Bayview Junction, CP Spence Pretripping
 * Facility, GO Transit Streetsville Bus Garage, First Student Charter Bus Rental,
 * Greyhound Lines, MiWay Offices, VIA Rail Union Station Business Lounge, and platform /
 * carpool / park-and-ride rows that name a station they are not.
 */
const NOT_A_STATION =
  /\bstop\b|platform|carpool|park\s*&\s*ride|park and ride|\bgarage\b|shuttle|charter|rental|\boffices?\b|\bdepot\b|\bloop\b|\byard\b|junction|maintenance|freight|pretripping|railing|\blines\b|\bco\.?$|business lounge|rail(way)? museum/i;

/** Same station under several aliases sits within a block. See dedupe below. */
const DEDUPE_METRES = 250;

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const p = Math.PI / 180;
  const dLat = (bLat - aLat) * p;
  const dLng = (bLng - aLng) * p;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Which alias survives a cluster. Union Station arrives as eighteen records — "Union
 * Station", "GO Transit-Union Station", "Gare Union de Toronto", "Toronto Union Station,
 * York Concourse", "Union Station - Toronto Railyard". Prefer a GO marker, then an
 * explicit station/terminal word, then the shortest name, so the winner is the one a user
 * would recognise rather than whichever Overture happened to list first. Lower is better.
 */
export function aliasRank(name: string): number {
  let s = 0;
  if (/\bGO\b/i.test(name)) s -= 4;
  if (/\bstation\b|\bterminal\b/i.test(name)) s -= 2;
  return s + name.length / 100;
}

export function classifyTransit(raw: RawPOI[]): Amenity[] {
  const kept: Array<RawPOI & { name: string; lat: number; lng: number }> = [];

  for (const r of raw) {
    // The GTA bbox reaches across the Niagara River, so a bbox-only filter also returns
    // Buffalo, Lockport and North Tonawanda. Every row carries a region — use it.
    if (r.region !== 'ON') continue;
    const name = String(r.name ?? '').trim();
    if (!name) continue;
    if (NOT_A_STATION.test(name)) continue;
    if (!STATION_WORD.test(name)) continue;
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    kept.push({ ...r, name, lat, lng });
  }

  // Rank first, then sweep: the survivor of each cluster is the best-named record in it,
  // not the first one encountered.
  kept.sort((a, b) => aliasRank(a.name) - aliasRank(b.name));

  const out: Amenity[] = [];
  for (const r of kept) {
    if (out.some((o) => haversineM(r.lat, r.lng, o.lat, o.lng) < DEDUPE_METRES)) continue;
    out.push({
      id: r.id,
      name: r.name,
      type: 'transit',
      category: String(r.category ?? '').trim(),
      lat: Math.round(r.lat * 1e6) / 1e6,
      lng: Math.round(r.lng * 1e6) / 1e6,
      address: [r.street, r.city, r.postcode]
        .map((s) => String(s ?? '').trim())
        .filter(Boolean)
        .join(', '),
    });
  }
  return out;
}

function main() {
  if (!fs.existsSync(RAW_FILE)) {
    throw new Error(
      `Missing ${path.relative(process.cwd(), RAW_FILE)} — run "python scripts/admin/overture_amenities.py --transit" first.`
    );
  }
  const raw = JSON.parse(fs.readFileSync(RAW_FILE, 'utf-8')) as RawPOI[];
  console.log(`Read ${raw.length} candidate transit POIs from Overture extract`);

  const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8')) as Amenity[];
  const preserved = existing.filter((a) => a.type !== 'transit');
  const transit = classifyTransit(raw);

  const merged = [...preserved, ...transit].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(OUT_FILE, JSON.stringify(merged));

  const counts = merged.reduce<Record<string, number>>((acc, a) => {
    acc[a.type] = (acc[a.type] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nWrote ${merged.length} amenities → data/gta-amenities.json`);
  console.log(`  ${Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join(' | ')}`);
  console.log(`  preserved non-transit rows: ${preserved.length} (grocery/recreation untouched)`);
  console.log(`  transit dropped by name/region/geo: ${raw.length - transit.length}`);
}

if (require.main === module) main();
