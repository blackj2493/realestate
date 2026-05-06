// Test script to verify VOW API media access
// Run with: npx ts-node test-vow-media.ts

import { createVowClient } from './src/lib/proptx';

const VOW_TOKEN = process.env.PROPTX_VOW_TOKEN;

async function testVowMedia() {
  console.log('🔌 Testing VOW API Media Access\n');
  console.log('='.repeat(50));
  
  if (!VOW_TOKEN) {
    console.error('❌ PROPTX_VOW_TOKEN not found in environment');
    return false;
  }
  
  try {
    const client = createVowClient(VOW_TOKEN);
    console.log('✓ VOW Client created\n');
    
    // Step 1: Get a sample property
    console.log('📍 Step 1: Fetching sample active listings...');
    const properties = await client.getActiveListings({ $top: 3 });
    console.log(`   Found ${properties.value.length} listings\n`);
    
    if (properties.value.length === 0) {
      console.log('❌ No active listings found');
      return false;
    }
    
    // Test with first property
    const sampleProperty = properties.value[0];
    console.log('   Sample Property:');
    console.log(`   - ListingKey: ${sampleProperty.ListingKey}`);
    console.log(`   - Address: ${sampleProperty.UnparsedAddress || 'N/A'}`);
    console.log(`   - City: ${sampleProperty.City}`);
    console.log(`   - Price: $${sampleProperty.ListPrice?.toLocaleString() || 'N/A'}\n`);
    
    // Step 2: Get media for this property
    console.log('📷 Step 2: Fetching media for listing...');
    console.log(`   Filter: ResourceRecordKey eq '${sampleProperty.ListingKey}' and ResourceName eq 'Property'\n`);
    
    const media = await client.getMedia(sampleProperty.ListingKey);
    console.log(`   Media items returned: ${media.value.length}`);
    
    if (media.value.length > 0) {
      console.log('\n   📸 Sample Media URLs:');
      media.value.slice(0, 5).forEach((m, i) => {
        console.log(`   ${i + 1}. ${m.MediaURL}`);
        console.log(`      Type: ${m.MediaType}, Order: ${m.Order}, Size: ${m.ImageSizeDescription}`);
      });
      
      // Check URL validity
      console.log('\n   🔗 URL Validation:');
      const firstMedia = media.value[0];
      if (firstMedia.MediaURL) {
        const isHttps = firstMedia.MediaURL.startsWith('https://');
        const hasExtension = /\.(jpg|jpeg|png|gif|webp)/i.test(firstMedia.MediaURL);
        console.log(`   - Uses HTTPS: ${isHttps ? '✓' : '✗'}`);
        console.log(`   - Has image extension: ${hasExtension ? '✓' : '?'}`);
      }
    } else {
      console.log('   ⚠️  No media found for this listing');
      console.log('   This could mean:');
      console.log('   - Listing has no photos');
      console.log('   - Token does not have media access');
      console.log('   - Filter is not matching correctly');
    }
    
    // Step 3: Try batch media request
    console.log('\n📦 Step 3: Testing batch media request...');
    const listingKeys = properties.value.map(p => p.ListingKey);
    const batchMedia = await client.getMediaForListings(listingKeys);
    console.log(`   Batch request for ${listingKeys.length} listings returned ${batchMedia.value.length} media items`);
    
    // Step 4: Try direct media query (all media with limit)
    console.log('\n🌐 Step 4: Testing direct /Media endpoint...');
    try {
      const allMedia = await client.getAllMedia({ $top: 5 });
      console.log(`   Direct /Media query returned ${allMedia.value.length} items`);
      
      if (allMedia.value.length > 0) {
        console.log('\n   First item structure:');
        const first = allMedia.value[0];
        console.log(`   - MediaKey: ${first.MediaKey}`);
        console.log(`   - ResourceName: ${first.ResourceName}`);
        console.log(`   - ResourceRecordKey: ${first.ResourceRecordKey}`);
        console.log(`   - MediaURL: ${first.MediaURL}`);
        console.log(`   - MediaType: ${first.MediaType}`);
      }
    } catch (e) {
      console.log(`   Direct /Media query failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ VOW Media Test Complete!');
    
    return media.value.length > 0;
  } catch (error) {
    console.error('\n❌ VOW API Error:', error instanceof Error ? error.message : 'Unknown error');
    console.error('Full error:', error);
    return false;
  }
}

testVowMedia().then((success) => {
  console.log(`\nResult: ${success ? 'Media access working!' : 'Media access failed or no media available'}`);
  process.exit(success ? 0 : 1);
});