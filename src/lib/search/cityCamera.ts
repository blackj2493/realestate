/**
 * Resolve a map camera for a selected CITY / community from the terminal search.
 *
 * WHY: a city suggestion carries no coordinates (it's a Typesense facet count), so before
 * this the city path never commanded the camera — it only set the text query and relied on
 * AlphaMap's auto-fit-to-results, which silently fails on mobile (the map is hidden behind
 * the search overlay / list view when the results land, so the reframe is dropped). Routing
 * a city through the robust `setFlyTo` path (the one address/geo already use) fixes that.
 *
 * Resolution is instant for the hand-tuned quick-pick markets; for any other city we run a
 * single Typesense query over the city's own listings and frame their dense cluster — the
 * same median-centered, 10–90th-percentile framing AlphaMap's auto-fit uses, so the result
 * matches what the map would have shown, just delivered reliably.
 */

import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { areaFilter, regionArea, marketCamera } from "@/lib/dashboard/area";

export interface CityCamera {
  lat: number;
  lng: number;
  zoom: number;
}

/** Median center + zoom framing the 10–90th-percentile span of the listings' locations. */
export function frameFromListings(listings: ListingDocument[]): CityCamera | null {
  const pts = listings
    .map((l) => l.location)
    .filter(
      (loc): loc is [number, number] =>
        Array.isArray(loc) && Number.isFinite(loc[0]) && Number.isFinite(loc[1])
    );
  if (pts.length === 0) return null;

  const lats = pts.map((p) => p[0]).sort((a, b) => a - b);
  const lngs = pts.map((p) => p[1]).sort((a, b) => a - b);
  const pct = (arr: number[], p: number) =>
    arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))];

  const lat = pct(lats, 0.5);
  const lng = pct(lngs, 0.5);
  const range = Math.max(pct(lats, 0.9) - pct(lats, 0.1), pct(lngs, 0.9) - pct(lngs, 0.1));
  // Same clamp shape as AlphaMap's auto-fit (a hair tighter max so a single searched
  // city frames closer than a scattered persona result set).
  const zoom = range > 0 ? Math.max(8, Math.min(14, 12 - Math.log10(range * 100))) : 13;
  return { lat, lng, zoom };
}

/**
 * Camera for a selected city/community label, or null if it can't be resolved (the caller
 * then simply leaves the auto-fit path to do its best). Best-effort — never throws.
 */
export async function resolveCityCamera(label: string): Promise<CityCamera | null> {
  const market = marketCamera(label);
  if (market) return { lat: market.lat, lng: market.lng, zoom: market.zoom };

  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: areaFilter(regionArea(label)),
      perPage: 80,
    });
    return frameFromListings(res.listings);
  } catch {
    return null;
  }
}
