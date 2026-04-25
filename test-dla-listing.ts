// Test DLA API with listing X12639568
import 'dotenv/config';
import { ProptXClient } from './src/lib/proptx/client';

async function testDLA() {
  const dlaToken = process.env.PROPTX_DLA_TOKEN;
  
  if (!dlaToken) {
    console.error('PROPTX_DLA_TOKEN not found in environment');
    return;
  }
  
  console.log('Testing DLA API with listing: X12639568\n');
  
  const client = new ProptXClient(dlaToken, 'DLA');
  
  try {
    // Fetch the specific property using ListingKey
    const properties = await client.getProperties({
      '$filter': `ListingKey eq 'X12639568'`
    } as any);
    
    console.log('=== DLA API Response for Listing X12639568 ===\n');
    console.log('Full response:', JSON.stringify(properties, null, 2));
    if (properties.value && properties.value.length > 0) {
      console.log('\n=== Property Details ===\n');
      console.log(JSON.stringify(properties.value[0], null, 2));
    } else {
      console.log('No property found with DLA token');
    }
  } catch (error) {
    console.error('Error fetching DLA data:', error);
  }
}

testDLA();
