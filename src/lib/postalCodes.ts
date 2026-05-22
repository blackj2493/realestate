import fs from 'fs';
import path from 'path';
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
// Ontario LDU library is the PRIMARY source (full 6-char postal codes, ~298k rows).
// postalCodeMap (Canada-wide JSON) + fsaMap (FSA centroids) are fallbacks.
const ontarioMap: Map<string, { lat: number; lng: number }> = new Map();
const postalCodeMap: Map<string, { lat: number; lng: number }> = new Map();
const fsaMap: Map<string, { lat: number; lng: number }> = new Map();
let isLoaded = false;

// Normalize a postal code to the keying convention: uppercase, no spaces.
function normalizePostal(code: string): string {
  return code.toUpperCase().replace(/\s/g, '');
}

// Load the Ontario LDU file (tab-separated: "Postal Code\tLat\tLong").
// Server/worker only — never bundled into the client. Failures are non-fatal;
// lookups fall through to the Canada-wide JSON + FSA centroids.
function loadOntarioPostalCodes(): void {
  const filePath = path.join(process.cwd(), 'data', 'Ontario-postal-code-to-coordinate.txt');
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.warn(`[PostalCodes] Ontario LDU file not loaded (${filePath}): ${(err as Error).message}`);
    return;
  }

  const lines = raw.split('\n');
  for (let i = 1; i < lines.length; i++) {
    // split on TAB only — postal codes contain an internal space ("K0A 0A1")
    const parts = lines[i].split('\t');
    if (parts.length < 3) continue;
    const key = normalizePostal(parts[0]);
    const lat = parseFloat(parts[1]);
    const lng = parseFloat(parts[2]);
    if (!key || Number.isNaN(lat) || Number.isNaN(lng)) continue;
    ontarioMap.set(key, { lat, lng });
  }
}

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

  // Load Ontario LDU library (primary source)
  loadOntarioPostalCodes();

  const elapsed = Date.now() - start;
  console.log(`[PostalCodes] Loaded ${ontarioMap.size} Ontario LDU, ${postalCodeMap.size} Canada postal codes and ${fsaMap.size} FSA centroids in ${elapsed}ms`);
  isLoaded = true;
}

// Get coordinates for a postal code with fallback to FSA
export function getCoordinates(postalCode: string | null | undefined): { lat: number; lng: number } | null {
  if (!postalCode) return null;

  const normalized = normalizePostal(postalCode);

  // Tier 1: Ontario LDU library (primary, most precise)
  const ontarioMatch = ontarioMap.get(normalized);
  if (ontarioMatch) {
    return ontarioMatch;
  }

  // Tier 2: Canada-wide postal code JSON (exact)
  const exactMatch = postalCodeMap.get(normalized);
  if (exactMatch) {
    return exactMatch;
  }

  // Tier 3: FSA fallback (first 3 characters)
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
export function getStats(): { ontarioLdu: number; postalCodes: number; fsaCentroids: number } {
  return {
    ontarioLdu: ontarioMap.size,
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
