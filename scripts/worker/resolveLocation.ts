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

import { getCoordinates, loadPostalCodes, isDataLoaded } from '@/lib/postalCodes';

export const FALLBACK_LAT = 43.6532; // Toronto center latitude
export const FALLBACK_LNG = -79.3832; // Toronto center longitude

export interface GeolocationResult {
  location: [number, number]; // [lat, lng] — Typesense geopoint convention
  needsGeocoding: boolean;
}

/**
 * Resolves a geopoint via a strict fallback chain, always as [lat, lng]:
 *   1. Postal-code library (Ontario LDU → Canada → FSA centroid)
 *   2. API-native coordinates
 *   3. Toronto center (flagged needsGeocoding)
 */
export function resolveLocation(
  postalCode: string | null | undefined,
  apiLat: number | null | undefined,
  apiLng: number | null | undefined
): GeolocationResult {
  if (!isDataLoaded()) loadPostalCodes();

  // Tier 1: postal-code library lookup
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

  // Tier 3: Toronto-center fallback, flagged for correction
  console.warn(`[resolveLocation] location fallback for postal: ${postalCode || 'unknown'}`);
  return {
    location: [FALLBACK_LAT, FALLBACK_LNG] as [number, number],
    needsGeocoding: true,
  };
}
