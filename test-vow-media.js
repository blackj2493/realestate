// Test script to verify VOW API media access
// Run with: node test-vow-media.js
// Reads token from .env file

const fs = require('fs');
const path = require('path');

// Read .env file
function getEnv() {
  const envPath = path.join(__dirname, '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};
  
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  });
  
  return env;
}

const env = getEnv();
const API_BASE_URL = env.AMPRE_API_URL || 'https://query.ampre.ca/odata';
const VOW_TOKEN = env.PROPTX_VOW_TOKEN;

async function request(endpoint, params) {
  let urlString = `${API_BASE_URL}${endpoint}`;
  
  if (params) {
    const queryParts = [];
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParts.push(`${key}=${encodeURIComponent(value)}`);
      }
    }
    if (queryParts.length > 0) {
      urlString += '?' + queryParts.join('&');
    }
  }

  console.log('   URL:', urlString.substring(0, 100) + '...');
  
  const response = await fetch(urlString, {
    headers: {
      'Authorization': `Bearer ${VOW_TOKEN}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(error.error?.message || `API Error: ${response.status}`);
  }

  return response.json();
}

async function testVowMedia() {
  console.log('\n🔌 Testing VOW API Media Access\n');
  console.log('='.repeat(50));
  
  if (!VOW_TOKEN) {
    console.error('❌ PROPTX_VOW_TOKEN not found in environment');
    return false;
  }
  
  try {
    console.log('✓ VOW Token loaded\n');
    
    // Step 1: Get a sample property
    console.log('📍 Step 1: Fetching sample active listings...');
    const properties = await request('/Property', { 
      '$filter': "StandardStatus eq 'Active'",
      '$top': '3' 
    });
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
    
    // Step 2: Get media for this property (with ResourceName filter per RESO spec)
    console.log('📷 Step 2: Fetching media for listing...');
    const mediaFilter = `ResourceRecordKey eq '${sampleProperty.ListingKey}' and ResourceName eq 'Property'`;
    console.log(`   Filter: ${mediaFilter}\n`);
    
    const media = await request('/Media', { '$filter': mediaFilter });
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
    const recordKeyFilter = listingKeys.map(key => `ResourceRecordKey eq '${key}'`).join(' or ');
    const batchFilter = `(${recordKeyFilter}) and ResourceName eq 'Property'`;
    const batchMedia = await request('/Media', { '$filter': batchFilter });
    console.log(`   Batch request for ${listingKeys.length} listings returned ${batchMedia.value.length} media items`);
    
    // Step 4: Try direct media query (all media with limit)
    console.log('\n🌐 Step 4: Testing direct /Media endpoint (no filter)...');
    try {
      const allMedia = await request('/Media', { '$top': '5' });
      console.log(`   Direct /Media query returned ${allMedia.value.length} items`);
      
      if (allMedia.value.length > 0) {
        console.log('\n   First item structure:');
        const first = allMedia.value[0];
        console.log(`   - MediaKey: ${first.MediaKey}`);
        console.log(`   - ResourceName: ${JSON.stringify(first.ResourceName)}`);
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