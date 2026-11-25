/**
 * Toronto licensed child care near a point.
 *
 * Data: data/toronto-child-care.json, built by scripts/data/buildTorontoChildCare.ts from
 * the City of Toronto "Licensed Child Care Centres" feed (OGL-Toronto, updated daily) and
 * the 2021 Census neighbourhood profiles (children aged 0 to 4). Refreshed weekly by
 * refresh-child-care.yml.
 *
 * Toronto only. No other city publishes centre locations with spaces by age group: the
 * Ontario list has addresses but no capacity, and the Peel/Durham/Waterloo layers are
 * 1-3 years old. Do not mix another source into these numbers.
 *
 * SPACES ARE CAPACITY, NOT VACANCIES. A licensed space is a place the centre may fill,
 * not an open spot. Every surface that shows them says so.
 */

export interface ChildCareCentre {
  id: number;
  name: string;
  lat: number;
  lng: number;
  /** Licensed spaces by age group (Ontario CCEYA groups). */
  infant: number; // 0-18 months
  toddler: number; // 18-30 months
  preschool: number; // 30 months - 6 years
  kindergarten: number;
  schoolAge: number;
  /** In the Canada-Wide Early Learning and Child Care ($10-a-day) program. */
  cwelcc: boolean;
}

export interface ChildCareNeighbourhood {
  name: string;
  /** Children aged 0 to 4, 2021 Census. */
  children: number;
  centres: number;
  infant: number;
  /** Infant + toddler + preschool spaces. */
  youngSpaces: number;
  /** youngSpaces per 100 children aged 0 to 4, one decimal. */
  per100: number;
  /** Rings of [lng, lat] pairs; the first ring of each polygon is the outer ring. */
  polygons: [number, number][][][];
}

export interface ChildCareFile {
  updated: string; // ISO date of the feed snapshot
  source: string;
  centres: ChildCareCentre[];
  neighbourhoods: ChildCareNeighbourhood[];
  city: { children: number; youngSpaces: number; infant: number; per100: number; infantPer100: number };
}

export interface NearbyChildCare {
  radiusKm: number;
  count: number;
  infantSpaces: number;
  centresWithInfant: number;
  cwelccCount: number;
  /** Nearest centre with infant spaces inside the search radius × 3, or null. */
  nearestInfant: { name: string; distanceKm: number } | null;
  centres: (ChildCareCentre & { distanceKm: number })[];
  neighbourhood: { name: string; per100: number; rankFromTop: number; of: number } | null;
  cityPer100: number;
  updated: string;
}

export const CHILD_CARE_RADIUS_KM = 1;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Ray casting on one ring of [lng, lat] pairs. */
function inRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A polygon is [outer, ...holes]. Inside = in the outer ring and in no hole. */
export function inPolygons(lng: number, lat: number, polygons: [number, number][][][]): boolean {
  return polygons.some((poly) => inRing(lng, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lng, lat, h)));
}

/** "LE PETIT CHAPERON ROUGE - COXWELL" → "Le Petit Chaperon Rouge - Coxwell". Mixed case is kept. */
export function displayName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s(\-/&#.])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

export function nearbyChildCare(file: ChildCareFile, lat: number, lng: number, radiusKm = CHILD_CARE_RADIUS_KM): NearbyChildCare {
  const box = radiusKm * 3;
  const scored = [];
  for (const c of file.centres) {
    if (Math.abs(c.lat - lat) > box / 100 || Math.abs(c.lng - lng) > box / 70) continue;
    scored.push({ ...c, distanceKm: Math.round(haversineKm(lat, lng, c.lat, c.lng) * 100) / 100 });
  }
  scored.sort((a, b) => a.distanceKm - b.distanceKm);
  const inRange = scored.filter((c) => c.distanceKm <= radiusKm);
  const infantSpaces = inRange.reduce((s, c) => s + c.infant, 0);
  const nearest = scored.find((c) => c.infant > 0 && c.distanceKm <= box);

  let neighbourhood: NearbyChildCare["neighbourhood"] = null;
  const home = file.neighbourhoods.find((n) => inPolygons(lng, lat, n.polygons));
  if (home) {
    const rankFromTop = file.neighbourhoods.filter((n) => n.per100 > home.per100).length + 1;
    neighbourhood = { name: home.name, per100: home.per100, rankFromTop, of: file.neighbourhoods.length };
  }

  return {
    radiusKm,
    count: inRange.length,
    infantSpaces,
    centresWithInfant: inRange.filter((c) => c.infant > 0).length,
    cwelccCount: inRange.filter((c) => c.cwelcc).length,
    nearestInfant: nearest ? { name: nearest.name, distanceKm: nearest.distanceKm } : null,
    centres: inRange,
    neighbourhood,
    cityPer100: file.city.per100,
    updated: file.updated,
  };
}
