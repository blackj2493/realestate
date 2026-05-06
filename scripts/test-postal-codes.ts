/**
 * Test postal code lookup functionality
 */
import { loadPostalCodes, getCoordinates, getStats, getFsaCentroid } from '../src/lib/postalCodes';

console.log('Loading postal codes...');
loadPostalCodes();

const stats = getStats();
console.log('\n=== STATS ===');
console.log('Postal codes loaded:', stats.postalCodes);
console.log('FSA centroids loaded:', stats.fsaCentroids);

console.log('\n=== TESTS ===');
console.log('Test "L6P 2Z1":', getCoordinates('L6P 2Z1'));
console.log('Test "M5V 3T6":', getCoordinates('M5V 3T6'));
console.log('Test "K0A 0A1":', getCoordinates('K0A 0A1'));

console.log('\n=== FSA FALLBACK TESTS ===');
console.log('Test "L6P" (FSA):', getCoordinates('L6P'));
console.log('Test "M5V" (FSA):', getCoordinates('M5V'));
console.log('FSA direct "L6P":', getFsaCentroid('L6P'));
console.log('FSA direct "M5V":', getFsaCentroid('M5V'));
console.log('FSA direct "K0A":', getFsaCentroid('K0A'));

console.log('\n=== EDGE CASES ===');
console.log('Test "L6P2Z1" (no space):', getCoordinates('L6P2Z1'));
console.log('Test "l6p 2z1" (lowercase):', getCoordinates('l6p 2z1'));
console.log('Test null:', getCoordinates(null));
console.log('Test empty string:', getCoordinates(''));