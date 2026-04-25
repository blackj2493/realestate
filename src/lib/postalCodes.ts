import postalCodesData from '@/data/postal-codes.json';
import fsaCentroidsData from '@/data/fsa-centroids.json';

// Types
interface PostalCodeEntry {
  postalCode: string;
  lat: number;
  lng: number;
}

interface FsaCentroid {
  fsa: string;
  lat: number;
  lng: number;
}

// In-memory caches
let postalCodeMap: Map<string, { lat: number; lng: number }> = new Map();
let fsaMap: Map<string, { lat: number; lng: number }> = new Map();
let isLoaded = false;

// Load postal codes into memory
export function loadPostalCodes(): void {
  if (isLoaded) return;

  console.log('[PostalCodes] Loading postal codes into memory...');
  const start = Date.now();

  // Load full postal codes
  (postalCodesData as PostalCodeEntry[]).forEach((entry) => {
    postalCodeMap.set(entry.postalCode, { lat: entry.lat, lng: entry.lng });
  });

  // Load FSA centroids
  (fsaCentroidsData as FsaCentroid[]).forEach((entry) => {
    fsaMap.set(entry.fsa, { lat: entry.lat, lng: entry.lng });
  });

  const elapsed = Date.now() - start;
  console.log(`[PostalCodes] Loaded ${postalCodeMap.size} postal codes and ${fsaMap.size} FSA centroids in ${elapsed}ms`);
  isLoaded = true;
}

// Get coordinates for a postal code with fallback to FSA
export function getCoordinates(postalCode: string | null | undefined): { lat: number; lng: number } | null {
  if (!postalCode) return null;

  const normalized = postalCode.toUpperCase().replace(/\s/g, '');

  // Tier 1: Exact match
  const exactMatch = postalCodeMap.get(normalized);
  if (exactMatch) {
    return exactMatch;
  }

  // Tier 2: FSA fallback (first 3 characters)
  const fsa = normalized.substring(0, 3);
  const fsaMatch = fsaMap.get(fsa);
  if (fsaMatch) {
    return fsaMatch;
  }

  // Not found - return null
  return null;
}

// Get FSA centroid only (for testing/debugging)
export function getFsaCentroid(fsa: string): { lat: number; lng: number } | null {
  return fsaMap.get(fsa.toUpperCase()) || null;
}

// Get all loaded data size info
export function getStats(): { postalCodes: number; fsaCentroids: number } {
  return {
    postalCodes: postalCodeMap.size,
    fsaCentroids: fsaMap.size
  };
}

// Check if data is loaded
export function isDataLoaded(): boolean {
  return isLoaded;
}
