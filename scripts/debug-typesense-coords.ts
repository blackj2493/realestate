/**
 * Debug script to check Typesense location data directly
 * Run: npx tsx scripts/debug-typesense-coords.ts
 */

import { getTypesenseClient } from '../src/lib/typesense/client';

async function checkTypesenseCoords() {
  const client = getTypesenseClient();
  
  console.log('=== Checking Typesense Location Data ===\n');
  
  try {
    // Fetch a sample of documents with their location data
    const results = await (client as any)
      .collections('listings')
      .documents()
      .search({
        q: '*',
        per_page: 20,
        include_fields: 'id,UnparsedAddress,City,location,postal_code,list_price'
      });
    
    console.log(`Found ${results.found} total documents\n`);
    
    let invalidCoordsCount = 0;
    let validCoordsCount = 0;
    
    results.hits.forEach((hit: any, index: number) => {
      const doc = hit.document;
      const location = doc.location;
      
      // Check if coordinates are valid Canada coordinates
      const lat = location?.[0];
      const lng = location?.[1];
      
      // Canada bounding box: 41°N to 84°N, 141°W to 53°W
      const isValidCanada = lat && lng && lat >= 41 && lat <= 84 && lng >= -141 && lng <= -53;
      
      if (!isValidCanada && lat && lng) {
        invalidCoordsCount++;
        console.log(`❌ INVALID #${index + 1}:`);
        console.log(`   ID: ${doc.id}`);
        console.log(`   Address: ${doc.UnparsedAddress}`);
        console.log(`   City: ${doc.City}`);
        console.log(`   Location (lat, lng): [${lat}, ${lng}]`);
        console.log(`   postal_code: ${doc.postal_code}`);
        console.log('');
      } else if (isValidCanada) {
        validCoordsCount++;
        // Only show first 5 valid ones
        if (validCoordsCount <= 5) {
          console.log(`✅ VALID #${index + 1}:`);
          console.log(`   ID: ${doc.id}`);
          console.log(`   Address: ${doc.UnparsedAddress}`);
          console.log(`   Location (lat, lng): [${lat}, ${lng}]`);
          console.log('');
        }
      }
    });
    
    console.log('=== SUMMARY ===');
    console.log(`Valid Canada coordinates: ${validCoordsCount}`);
    console.log(`Invalid coordinates (likely wrong data): ${invalidCoordsCount}`);
    
    if (invalidCoordsCount > 0) {
      console.log('\n⚠️  WARNING: Found documents with invalid coordinates!');
      console.log('The Ecuador issue is likely caused by bad data in Typesense.');
    }
    
  } catch (error) {
    console.error('Error checking Typesense:', error);
  }
}

checkTypesenseCoords();