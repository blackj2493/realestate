import postalCodesData from './data/postal-codes.json';
import fsaCentroidsData from './data/fsa-centroids.json';

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
const postalCodeMap = new Map<string, { lat: number; lng: number }>();
const fsaMap = new Map<string, { lat: number; lng: number }>();

console.log('Loading postal codes into memory...');
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
console.log(`Loaded ${postalCodeMap.size} postal codes and ${fsaMap.size} FSA centroids in ${elapsed}ms`);

// Test function
function getCoordinates(postalCode: string): { lat: number; lng: number } | null {
  if (!postalCode) return null;
  const normalized = postalCode.toUpperCase().replace(/\s/g, '');
  const exactMatch = postalCodeMap.get(normalized);
  if (exactMatch) return exactMatch;
  const fsa = normalized.substring(0, 3);
  return fsaMap.get(fsa) || null;
}

// Test cases - sample Ontario postal codes
const testCases = [
  'M5V 3A8',      // Toronto downtown
  'M5V3A8',       // Same, no space
  'L4W 0A8',      // Mississauga
  'L4W0A8',       // Same, no space
  'N6L 0E8',      // London
  'M5V XXX',      // Unknown suffix (use FSA)
  'INVALID',      // Unknown
];

console.log('\n--- Coordinate Lookup Test ---');
testCases.forEach(postalCode => {
  const coords = getCoordinates(postalCode);
  if (coords) {
    console.log(`${postalCode}: ✓ (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`);
  } else {
    console.log(`${postalCode}: ✗ Not found`);
  }
});

// Test sample property postal codes from VOW API
console.log('\n--- Testing Sample Property Postal Codes ---');
const samplePropertyPostalCodes = [
  'N6L 0E8',      // London, Ontario
  'L4W 0A8',      // Mississauga
  'M5V 3A8',      // Toronto
  'L6M 0J7',      // Oakville
];

samplePropertyPostalCodes.forEach(postalCode => {
  const coords = getCoordinates(postalCode);
  if (coords) {
    console.log(`${postalCode}: ✓ (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`);
  } else {
    console.log(`${postalCode}: ✗ Not found`);
  }
});
