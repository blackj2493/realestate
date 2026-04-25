// Test IDX API with listing X12639568
import 'dotenv/config';
import { ProptXClient } from './src/lib/proptx/client';

async function testIDX() {
  const idxToken = process.env.PROPTX_IDX_TOKEN;
  
  if (!idxToken) {
    console.error('PROPTX_IDX_TOKEN not found in environment');
    return;
  }
  
  console.log('Testing IDX API with listing: X12639568\n');
  
  const client = new ProptXClient(idxToken, 'IDX');
  
  try {
    // Fetch the specific property using ListingKey
    const properties = await client.getProperties({
      '$filter': `ListingKey eq 'X12639568'`
    } as any);
    
    console.log('=== IDX API Response for Listing X12639568 ===\n');
    console.log(JSON.stringify(properties.value[0], null, 2));
  } catch (error) {
    console.error('Error fetching IDX data:', error);
  }
}

testIDX();
