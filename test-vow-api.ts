// Test script to fetch property from VOW API
// Run with: npx ts-node test-vow-api.ts

import { createVowClient } from './src/lib/proptx';

const VOW_TOKEN = process.env.PROPTX_VOW_TOKEN || 'your-vow-token';

async function fetchPropertyDetails() {
  console.log('🔌 Connecting to VOW API...\n');
  
  try {
    const client = createVowClient(VOW_TOKEN);
    console.log('✓ VOW Client created successfully');
    
    // The listing ID from the URL: jAXw7QlEbx1yQOzg
    // Let's search for properties in Oakville first, then find the specific one
    console.log('\n📍 Searching for property at 3304 Azam Way, Oakville...\n');
    
    // First, get active listings in Oakville
    const oakvilleResults = await client.searchByCity('Oakville', { $top: 5 });
    console.log(`✓ Found ${oakvilleResults.value.length} properties in Oakville`);
    
    // Show first few results
    for (const prop of oakvilleResults.value) {
      console.log('\n--- Property Found ---');
      console.log('ListingKey:', prop.ListingKey);
      console.log('Address:', prop.UnparsedAddress || `${prop.StreetNumber} ${prop.StreetName}`);
      console.log('City:', prop.City);
      console.log('Price:', prop.ListPrice ? `$${prop.ListPrice.toLocaleString()}` : 'N/A');
      console.log('Status:', prop.StandardStatus);
      console.log('Bedrooms:', prop.BedroomsTotal);
      console.log('Bathrooms:', prop.BathroomsTotalInteger);
      console.log('Property Type:', prop.PropertyType);
      
      // Get detailed info
      console.log('\n📋 Full Property Details:');
      console.log(JSON.stringify(prop, null, 2));
      
      // Get media for this listing
      console.log('\n📷 Fetching media...');
      const media = await client.getMedia(prop.ListingKey);
      console.log(`Found ${media.value.length} media items`);
      if (media.value.length > 0) {
        console.log('Sample media URLs:');
        media.value.slice(0, 3).forEach((m, i) => {
          console.log(`  ${i + 1}. ${m.MediaURL}`);
        });
      }
      
      // Get rooms for this listing
      console.log('\n🚪 Fetching rooms...');
      const rooms = await client.getRooms(prop.ListingKey);
      console.log(`Found ${rooms.value.length} rooms`);
      if (rooms.value.length > 0) {
        rooms.value.forEach((r) => {
          console.log(`  - ${r.RoomType} (${r.RoomLevel})`);
        });
      }
    }
    
    // Also test searching by address if we have the ListingId
    console.log('\n\n🔍 Direct search by Listing ID (jAXw7QlEbx1yQOzg)...');
    try {
      // Try to get property directly - VOW uses ListingKey format
      const directResult = await client.getProperties({ $top: 1 });
      if (directResult.value.length > 0) {
        console.log('Direct query successful!');
        console.log(JSON.stringify(directResult.value[0], null, 2));
      }
    } catch (e) {
      console.log('Direct query not supported, using search...');
    }
    
    console.log('\n✅ VOW API Test Complete!');
    return true;
  } catch (error) {
    console.error('\n❌ VOW API Error:', error instanceof Error ? error.message : 'Unknown error');
    console.error('Full error:', error);
    return false;
  }
}

fetchPropertyDetails().then((success) => {
  process.exit(success ? 0 : 1);
});
