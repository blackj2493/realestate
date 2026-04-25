import * as fs from 'fs';
import * as path from 'path';

// Read the tab-delimited file
const filePath = path.join(process.cwd(), 'data', 'Ontario-postal-code-to-coordinate.txt');
const content = fs.readFileSync(filePath, 'utf-8');

const lines = content.trim().split('\n');
const header = lines[0]; // Skip header
const postalCodes: any[] = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  
  const parts = line.split('\t');
  if (parts.length >= 3) {
    const postalCode = parts[0].trim().toUpperCase().replace(/\s/g, '');
    const lat = parseFloat(parts[1].trim());
    const lng = parseFloat(parts[2].trim());
    
    if (postalCode && !isNaN(lat) && !isNaN(lng)) {
      postalCodes.push({ postalCode, lat, lng });
    }
  }
}

console.log(`Parsed ${postalCodes.length} postal codes`);

// Write to JSON file
const outputPath = path.join(process.cwd(), 'data', 'postal-codes.json');
fs.writeFileSync(outputPath, JSON.stringify(postalCodes));
console.log(`Written to ${outputPath}`);

// Also generate FSA centroids
const fsaMap = new Map<string, { lat: number; lng: number; count: number }>();
postalCodes.forEach(({ postalCode, lat, lng }) => {
  const fsa = postalCode.substring(0, 3);
  const existing = fsaMap.get(fsa);
  if (existing) {
    existing.lat = (existing.lat * existing.count + lat) / (existing.count + 1);
    existing.lng = (existing.lng * existing.count + lng) / (existing.count + 1);
    existing.count++;
  } else {
    fsaMap.set(fsa, { lat, lng, count: 1 });
  }
});

const fsaCentroids = Array.from(fsaMap.entries()).map(([fsa, data]) => ({
  fsa,
  lat: data.lat,
  lng: data.lng
}));

console.log(`Generated ${fsaCentroids.length} FSA centroids`);

const fsaOutputPath = path.join(process.cwd(), 'data', 'fsa-centroids.json');
fs.writeFileSync(fsaOutputPath, JSON.stringify(fsaCentroids));
console.log(`Written to ${fsaOutputPath}`);
