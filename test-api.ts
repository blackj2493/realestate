// Test script to verify Ampre API connection
// Run with: npx ts-node test-api.ts

import { createAmpreClient } from './src/lib/ampre';

const ACCESS_TOKEN = process.env.AMPRE_ACCESS_TOKEN || 'your-ampre-access-token';

async function testConnection() {
  console.log('🔌 Testing Ampre API connection...\n');
  
  try {
    const client = createAmpreClient(ACCESS_TOKEN);
    console.log('✓ Client created successfully');
    
    // Test fetching properties
    const result = await client.getProperties({ $top: 3 });
    console.log('✓ API connected! Found', result.value.length, 'property(ies)\n');
    
    // Display sample data
    if (result.value.length > 0) {
      console.log('📋 Sample property data:');
      console.log(JSON.stringify(result.value[0], null, 2));
    }
    
    return true;
  } catch (error) {
    console.error('❌ Connection failed:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

testConnection().then((success) => {
  process.exit(success ? 0 : 1);
});