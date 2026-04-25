// Test DLA API - fetch any property
import 'dotenv/config';
import { ProptXClient } from './src/lib/proptx/client';

async function testDLA() {
  const dlaToken = process.env.PROPTX_DLA_TOKEN;
  
  if (!dlaToken) {
    console.error('PROPTX_DLA_TOKEN not found in environment');
    return;
  }
  
  console.log('Testing DLA API - fetching any property\n');
  
  const client = new ProptXClient(dlaToken, 'DLA');
  
  try {
    // Fetch first 2 properties
    const properties = await client.getProperties({
      '$top': 2
    } as any);
    
    console.log('=== DLA API Response (First 2 properties) ===\n');
    if (properties.value && properties.value.length > 0) {
      console.log('Found', properties.value.length, 'properties');
      console.log('\nFirst property:\n');
      console.log(JSON.stringify(properties.value[0], null, 2));
    } else {
      console.log('No properties found with DLA token');
      console.log('Full response:', JSON.stringify(properties, null, 2));
    }
  } catch (error) {
    console.error('Error fetching DLA data:', error);
  }
}

testDLA();
