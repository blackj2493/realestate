/**
 * Shared geolocation resolver for the ETL.
 *
 * Single source of truth for the Typesense geopoint order. Used by BOTH the
 * daily-sync transformer (transformer.ts) and the one-off vault reindexer
 * (reindex-from-vault.ts) so the [lat, lng] order can never drift between the
 * two writers again (the original [lng, lat] bug existed precisely because this
 * logic was duplicated).
 *
 * Dependency-light by design: imports ONLY @/lib/postalCodes (fs/json — no
 * network, no TLS, no Supabase/Typesense). This keeps it safe to import into
 * the reindexer, which patches NODE_TLS_REJECT_UNAUTHORIZED before importing
 * Supabase and avoids transformer.ts's heavy module graph.
 */

import { getCoordinates, getCityCenter, loadPostalCodes, isDataLoaded } from '@/lib/postalCodes';

export const FALLBACK_LAT = 43.6532; // Toronto center latitude
export const FALLBACK_LNG = -79.3832; // Toronto center longitude

export interface GeolocationResult {
  location: [number, number]; // [lat, lng] — Typesense geopoint convention
  needsGeocoding: boolean;
}

/**
 * Resolves a geopoint via a strict fallback chain, always as [lat, lng], from
 * most precise to least. The guiding rule: NEVER drop a property at downtown
 * Toronto when a closer approximation exists — a centroid several km away adds
 * minimal value. Toronto center is the absolute last resort only.
 *   1. Postal-code library (Ontario LDU exact → Canada → FSA centroid)
 *   2. API-native coordinates
 *   3. City centre (approximate, flagged needsGeocoding)
 *   4. Toronto centre (only when postal AND city are both unresolvable)
 *
 * `city` is optional and backward-compatible; pass it so tier 3 can fire.
 */
export function resolveLocation(
  postalCode: string | null | undefined,
  apiLat: number | null | undefined,
  apiLng: number | null | undefined,
  city?: string | null | undefined
): GeolocationResult {
  if (!isDataLoaded()) loadPostalCodes();

  // Tier 1: postal-code library lookup (LDU exact, else FSA centroid)
  const postalCoords = getCoordinates(postalCode);
  if (postalCoords) {
    return {
      location: [postalCoords.lat, postalCoords.lng] as [number, number],
      needsGeocoding: false,
    };
  }

  // Tier 2: API-native coordinates
  if (apiLat !== null && apiLat !== undefined && apiLng !== null && apiLng !== undefined) {
    return {
      location: [apiLat, apiLng] as [number, number],
      needsGeocoding: false,
    };
  }

  // Tier 3: city centre — neighbourhood-accurate enough to beat downtown Toronto.
  const cityCoords = getCityCenter(city);
  if (cityCoords) {
    console.warn(`[resolveLocation] city-centre fallback for "${city}" (postal ${postalCode || 'unknown'})`);
    return {
      location: [cityCoords.lat, cityCoords.lng] as [number, number],
      needsGeocoding: true,
    };
  }

  // Tier 4: Toronto-centre fallback — absolute last resort, flagged for correction
  console.warn(`[resolveLocation] Toronto-centre fallback (postal ${postalCode || 'unknown'}, city ${city || 'unknown'})`);
  return {
    location: [FALLBACK_LAT, FALLBACK_LNG] as [number, number],
    needsGeocoding: true,
  };
}
