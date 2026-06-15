/**
 * Build the GTA grocery + recreation amenities dataset for proximity enrichment.
 *
 * Source: Overture Maps `places` theme (release 2026-05-20.0), CDLA-Permissive 2.0
 * (commercial use OK, attribution required: "© OpenStreetMap contributors, © Overture
 * Maps Foundation"). The raw candidate POIs are pulled from the public S3 bucket by the
 * companion extractor FIRST:
 *
 *   python scripts/admin/overture_amenities.py            # -> data/_geo_src/overture-amenities-raw.json
 *   npx.cmd tsx scripts/admin/build-amenities-dataset.ts  # -> data/gta-amenities.json
 *
 * This script does the deterministic classification + normalization (hardcoded rules,
 * no AI — CLAUDE.md §4):
 *   - grocery    = supermarket OR grocery_store (the two categories that hold the real
 *                  chains — Loblaws/Metro/Fortinos/No Frills/Longo's split across both)
 *   - recreation = community_center (sports_and_recreation_venue is ~78% noise — karting,
 *                  trampoline parks, pickleball clubs — so it is intentionally excluded)
 * Anything else is dropped. Output mirrors data/ontario-schools.json shape so the ETL
 * (assignAmenities) and the /api/amenities/nearby route can load it the same way.
 *
 * Output: data/gta-amenities.json — [{ id, name, type, category, lat, lng, address }].
 */
import * as fs from 'fs';
import * as path from 'path';

const RAW_FILE = path.join(process.cwd(), 'data', '_geo_src', 'overture-amenities-raw.json');
const OUT_FILE = path.join(process.cwd(), 'data', 'gta-amenities.json');

// GTA bbox guard (matches overture_amenities.py); drops stray out-of-region points.
const BOX = { xmin: -80.0, xmax: -78.5, ymin: 43.0, ymax: 44.5 };

interface RawPOI {
  id: string;
  name: string | null;
  category: string | null;
  alt_categories: string[] | null;
  lat: number | null;
  lng: number | null;
  street: string | null;
  city: string | null;
  postcode: string | null;
}

export type AmenityType = 'grocery' | 'recreation';

interface Amenity {
  id: string;
  name: string;
  type: AmenityType;
  category: string;
  lat: number;
  lng: number;
  address: string;
}

/** Deterministic category → amenity-type mapping (see header). null = drop. */
function classify(category: string): AmenityType | null {
  const c = category.toLowerCase();
  if (c === 'supermarket' || c === 'grocery_store') return 'grocery';
  if (c === 'community_center') return 'recreation';
  return null;
}

function main() {
  if (!fs.existsSync(RAW_FILE)) {
    throw new Error(
      `Missing ${path.relative(process.cwd(), RAW_FILE)} — run "python scripts/admin/overture_amenities.py" first.`
    );
  }
  const raw = JSON.parse(fs.readFileSync(RAW_FILE, 'utf-8')) as RawPOI[];
  console.log(`Read ${raw.length} candidate POIs from Overture extract`);

  const out: Amenity[] = [];
  const seenId = new Set<string>();
  const seenKey = new Set<string>();
  let droppedCat = 0;
  let droppedGeo = 0;
  let droppedDup = 0;

  for (const r of raw) {
    const category = String(r.category ?? '').trim();
    const type = category ? classify(category) : null;
    if (!type) {
      droppedCat++;
      continue;
    }
    const lat = typeof r.lat === 'number' ? r.lat : Number(r.lat);
    const lng = typeof r.lng === 'number' ? r.lng : Number(r.lng);
    if (
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lng < BOX.xmin || lng > BOX.xmax || lat < BOX.ymin || lat > BOX.ymax
    ) {
      droppedGeo++;
      continue;
    }
    const name = String(r.name ?? '').trim();
    if (!name) {
      droppedCat++; // unnamed POIs aren't useful to display
      continue;
    }

    // Dedup: Overture ids are unique, but conflation can still leave a store listed
    // twice at ~the same point — collapse on (type, name, 5dp coords) too.
    if (r.id && seenId.has(r.id)) {
      droppedDup++;
      continue;
    }
    const key = `${type}|${name.toLowerCase()}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
    if (seenKey.has(key)) {
      droppedDup++;
      continue;
    }
    if (r.id) seenId.add(r.id);
    seenKey.add(key);

    const address = [r.street, r.city, r.postcode]
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
      .join(', ');

    out.push({
      id: r.id,
      name,
      type,
      category,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      address,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  const grocery = out.filter((a) => a.type === 'grocery').length;
  const recreation = out.length - grocery;
  console.log(`\nWrote ${out.length} amenities → data/gta-amenities.json`);
  console.log(`  grocery: ${grocery} | recreation: ${recreation}`);
  console.log(`  dropped — category: ${droppedCat}, geo/bbox: ${droppedGeo}, duplicate: ${droppedDup}`);
}

try {
  main();
} catch (e: any) {
  console.error('❌', e?.message || e);
  process.exit(1);
}
