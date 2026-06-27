/**
 * Thin client for the existing /api/geocode (Mapbox, Ontario-biased) route.
 * Lets the search bar resolve ANY free-typed address — even one with no active
 * listing — to a coordinate so the map can fly there and drop a pin.
 */

export interface GeoHit {
  label: string;
  lat: number;
  lng: number;
}

export async function geocodeAddress(query: string): Promise<GeoHit | null> {
  const q = query.trim();
  if (q.length < 3) return null;
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: GeoHit[] };
    return data.results?.[0] ?? null;
  } catch {
    return null;
  }
}
