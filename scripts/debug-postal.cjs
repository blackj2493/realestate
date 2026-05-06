// Direct debug script - no TypeScript imports
const fs = require('fs');
const path = require('path');

console.log('=== DEBUG: Loading postal-codes.json ===');
const postalData = require('../data/postal-codes.json');
console.log('Type:', typeof postalData);
console.log('Is Array:', Array.isArray(postalData));
if (Array.isArray(postalData)) {
  console.log('Length:', postalData.length);
  console.log('First entry:', JSON.stringify(postalData[0]));
}

console.log('\n=== DEBUG: Loading fsa-centroids.json ===');
const fsaData = require('../data/fsa-centroids.json');
console.log('Type:', typeof fsaData);
console.log('Is Array:', Array.isArray(fsaData));
console.log('Keys:', Object.keys(fsaData).slice(0, 5));
if (!Array.isArray(fsaData)) {
  const vals = Object.values(fsaData);
  console.log('Sample entry:', JSON.stringify(vals[0]));
}

console.log('\n=== Simulating postalCodes.ts logic ===');
// Load postal codes into a Map
const postalCodeMap = new Map();
if (Array.isArray(postalData)) {
  postalData.forEach((entry) => {
    postalCodeMap.set(entry.postalCode, { lat: entry.lat, lng: entry.lng });
  });
}
console.log('Postal codes in map:', postalCodeMap.size);

// Load FSA centroids (current broken code that tries to iterate as array)
const fsaMap = new Map();
console.log('\n--- Current (broken) FSA loading ---');
console.log('typeof fsaData:', typeof fsaData);
console.log('Array.isArray(fsaData):', Array.isArray(fsaData));

if (Array.isArray(fsaData)) {
  fsaData.forEach((entry) => {
    if (entry.fsa) fsaMap.set(entry.fsa, { lat: entry.lat, lng: entry.lng });
  });
}
console.log('FSA entries loaded (current code):', fsaMap.size);

console.log('\n--- Fixed FSA loading (object format) ---');
if (!Array.isArray(fsaData) && typeof fsaData === 'object') {
  const vals = Object.values(fsaData);
  console.log('Object has', vals.length, 'entries');
  vals.forEach((entry) => {
    if (entry && entry.fsa) fsaMap.set(entry.fsa, { lat: entry.lat, lng: entry.lng });
  });
}
console.log('FSA entries loaded (fixed code):', fsaMap.size);

console.log('\n=== Testing lookups ===');
function getCoordinates(postalCode) {
  if (!postalCode) return null;
  const normalized = postalCode.toUpperCase().replace(/\s/g, '');
  const exactMatch = postalCodeMap.get(normalized);
  if (exactMatch) return exactMatch;
  const fsa = normalized.substring(0, 3);
  return fsaMap.get(fsa) || null;
}

console.log('Test "L6P 2Z1":', getCoordinates('L6P 2Z1'));
console.log('Test "M5V 3T6":', getCoordinates('M5V 3T6'));
console.log('Test "L6P" (FSA):', getCoordinates('L6P'));
console.log('Test "M5V" (FSA):', getCoordinates('M5V'));
console.log('FSA direct "L6P":', fsaMap.get('L6P'));
console.log('FSA direct "M5V":', fsaMap.get('M5V'));