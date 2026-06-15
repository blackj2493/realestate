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
 * Mis-tagged noise is then dropped: grocery candidates Overture also tags as restaurants
 * (isGroceryNoise), and community_center candidates that aren't real centres — pet stores,
 * charities, churches, offices (isRecreationNoise).
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

// Overture mis-tags many prepared-food eateries as grocery_store (mall sushi counters,
// pizza/coffee kiosks, even corporate HQs). A grocery candidate is dropped when Overture
// ALSO classifies it a restaurant (alt_categories) or its name is an unambiguous eatery —
// UNLESS the name carries a clear grocer signal (chain or ethnic/independent grocery),
// which always wins. Tuned to kill the Kikka-Sushi noise while keeping every real chain
// and named ethnic grocer; a few specialty shops are accepted collateral.
const GROCERY_WORD =
  /grocer|grocery|supermarket|food|market|mart|fruit|produce|halal|butcher|meat|fish|seafood|bazaar|spice|dairy|farm|convenience|deli|loblaw|sobey|metro|fortino|longo|freshco|zehr|costco|walmart|food basics|superstore|no frills|t&t|nations|valu|independent|asian|indian|persian|korean|chinese|polish/i;
const RESTAURANT_NAME =
  /\bsushi\b|\bpizza\b|\bramen\b|noodle|smoothie|bubble tea|cold brew|coffee co|\bcaf[eé]\b|\bbistro\b|\bdiner\b|shawarma|\bkebab\b|pupusa|\bdhaba\b|\bsandwich\b/i;

function hasRestaurantAlt(alt: string[] | null): boolean {
  return Array.isArray(alt) && alt.some((c) => /restaurant|fast_food|food_court/.test(c));
}

/** True when a grocery-categorized POI is really an eatery, not a grocery store. */
function isGroceryNoise(name: string, alt: string[] | null): boolean {
  if (GROCERY_WORD.test(name)) return false;
  return hasRestaurantAlt(alt) || RESTAURANT_NAME.test(name);
}

// community_center also sweeps in pet stores, charities, churches, schools, BIA offices
// and corporate orgs. Its alt_categories overlap real centres (community centres carry
// social_service/senior alts), so the reliable signal is the INVERSE: keep only when the
// name reads like a real centre (Centre/Recreation/YMCA/arena/pool/club/legion/hall/civic/
// cultural/…) OR the alt is clearly recreational (gym/pool/sports/park). Else drop.
const REC_WORD =
  /\bcent(re|er|ennial)?\b|recreation|\brec\b|ymca|ywca|\barena|aquatic|\bpool\b|leisure|sportsplex|memorial|gymnas|\bgym\b|fitness|athletic|curling|skat(e|ing)|\bclub|legion|\bhall\b|sports|parks? and rec|neighbou?rhood|civic|cultural|seniors?\b|\byouth\b|pavilion|fairground|arts? cent/i;

function hasRecreationAlt(alt: string[] | null): boolean {
  return (
    Array.isArray(alt) &&
    alt.some((c) =>
      /sports_and_recreation_venue|^gym$|active_life|swimming_pool|stadium_arena|^park$|recreation|sports_and_fitness|water_park|fitness|skating_rink|hockey_arena|athletic|cultural_center/.test(c)
    )
  );
}

/** True when a community_center POI isn't actually a recreation/community centre. */
function isRecreationNoise(name: string, alt: string[] | null): boolean {
  return !REC_WORD.test(name) && !hasRecreationAlt(alt);
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
  let droppedNoise = 0;

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

    // Drop mis-tagged noise: grocery candidates that are really eateries (mall sushi
    // counters, etc.) and community_center candidates that aren't real rec centres
    // (pet stores, charities, churches, offices).
    if (type === 'grocery' && isGroceryNoise(name, r.alt_categories)) {
      droppedNoise++;
      continue;
    }
    if (type === 'recreation' && isRecreationNoise(name, r.alt_categories)) {
      droppedNoise++;
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
  console.log(`  dropped — category: ${droppedCat}, geo/bbox: ${droppedGeo}, duplicate: ${droppedDup}, eatery-noise: ${droppedNoise}`);
}

try {
  main();
} catch (e: any) {
  console.error('❌', e?.message || e);
  process.exit(1);
}
