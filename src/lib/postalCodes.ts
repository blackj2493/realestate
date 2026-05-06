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

  // Handle both direct array and wrapped { value: [...] } structure
  const rawData = postalCodesData as unknown;
  let postalCodeEntries: PostalCodeEntry[] = [];
  
  if (Array.isArray(rawData)) {
    // Direct array format
    postalCodeEntries = rawData as PostalCodeEntry[];
  } else if (rawData && typeof rawData === 'object' && 'value' in (rawData as object)) {
    // Wrapped format { value: [...] }
    const wrapped = rawData as { value: PostalCodeEntry[] };
    postalCodeEntries = wrapped.value || [];
  }
  
  // Load full postal codes
  postalCodeEntries.forEach((entry) => {
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

// Canadian city center coordinates (fallback when postal code lookup fails)
export const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  "Toronto": { lat: 43.6532, lng: -79.3832 },
  "Brampton": { lat: 43.6859, lng: -79.7664 },
  "Mississauga": { lat: 43.5890, lng: -79.6441 },
  "Markham": { lat: 43.8561, lng: -79.3450 },
  "Oakville": { lat: 43.4474, lng: -79.6824 },
  "Burlington": { lat: 43.3862, lng: -79.8371 },
  "Milton": { lat: 43.4963, lng: -79.8828 },
  "Richmond Hill": { lat: 43.8828, lng: -79.4405 },
  "Vaughan": { lat: 43.8231, lng: -79.5089 },
  "Hamilton": { lat: 43.2557, lng: -79.8712 },
  "Ottawa": { lat: 45.4215, lng: -75.6972 },
  "London": { lat: 42.9849, lng: -81.2453 },
  "Kitchener": { lat: 43.4533, lng: -80.4754 },
  "Cambridge": { lat: 43.3976, lng: -80.3116 },
  "Waterloo": { lat: 43.4668, lng: -80.5246 },
  "Guelph": { lat: 43.5446, lng: -80.2481 },
  "Oshawa": { lat: 43.8971, lng: -78.8627 },
  "Barrie": { lat: 44.3894, lng: -79.6903 },
};

// Get city center coordinates (for fallback)
export function getCityCenter(cityName: string | null | undefined): { lat: number; lng: number } | null {
  if (!cityName) return null;
  return CITY_CENTERS[cityName] || null;
}

// Check if data is loaded
export function isDataLoaded(): boolean {
  return isLoaded;
}
