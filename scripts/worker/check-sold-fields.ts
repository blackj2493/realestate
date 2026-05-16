/**
 * Temporary script to dump raw MLS listing JSON for debugging.
 * Run with: npx tsx scripts/worker/check-sold-fields.ts
 * 
 * Queries a specific listing by MLS Number and dumps raw JSON.
 */
import 'dotenv/config';

const MLS_NUMBER = 'C12483765'; // User will provide this - hardcoded as instructed

async function main() {
  console.log(`🔍 Querying board for MLS Number: ${MLS_NUMBER}`);
  
  // Use ProptX VOW token specifically (not RESO_BEARER_TOKEN)
  const token = process.env.PROPTX_VOW_TOKEN;
  
  if (!token) {
    console.error('❌ PROPTX_VOW_TOKEN not found in environment');
    process.exit(1);
  }
  
  // Query for the original MLS number (no status filter)
  const filter = `ListingKey eq 'C12483765'`;
  const encodedFilter = encodeURIComponent(filter);
  const url = `https://query.ampre.ca/odata/Property?$filter=${encodedFilter}&$top=1&$count=true`;
  
  console.log(`📡 URL: ${url}`);
  console.log(`🔑 Token exists: ${token ? 'yes (length=' + token.length + ')' : 'no'}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error(`❌ HTTP Error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error(`Response body: ${text}`);
      return;
    }
    
    const data = await response.json();
    
    console.log('\n📦 Raw Board Response:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(data, null, 2));
    console.log('='.repeat(80));
    
    // If there are results, show the first one with all its fields
    if (data.value && data.value.length > 0) {
      const listing = data.value[0];
      
      console.log('\n📋 Field Names Found in Listing:');
      console.log('-'.repeat(40));
      
      // Show all top-level fields
      const fields = Object.keys(listing);
      fields.forEach(field => {
        const value = listing[field];
        const type = Array.isArray(value) ? 'array' : typeof value;
        const preview = type === 'object' ? JSON.stringify(value).substring(0, 50) + '...' : 
                        type === 'string' && value.length > 30 ? value.substring(0, 30) + '...' : 
                        String(value);
        console.log(`  ${field}: ${type} = ${preview}`);
      });
      
      console.log('-'.repeat(40));
      console.log(`Total fields: ${fields.length}`);
      
      // Check for status-related fields
      console.log('\n🔍 Status-Related Fields:');
      const statusFields = fields.filter(f => 
        f.toLowerCase().includes('status') || 
        f.toLowerCase().includes('sold') ||
        f.toLowerCase().includes('close') ||
        f.toLowerCase().includes('price') ||
        f.toLowerCase().includes('date')
      );
      statusFields.forEach(f => {
        console.log(`  ${f} = ${JSON.stringify(listing[f])}`);
      });
    } else {
      console.log('⚠️  No listings returned');
    }
    
  } catch (error) {
    console.error('❌ Request failed:', error);
  }
}

main().catch(console.error);