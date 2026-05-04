// Debug script to check why properties page shows no results
const Typesense = require('typesense');

const client = new Typesense.Client({
  nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
  apiKey: 'BzXkIss7SXH0U1Hb0a1COwdvEACxbhkj'
});

async function debugSearch() {
  console.log('=== Testing Typesense Search ===\n');
  
  // Test 1: Basic search (what properties page does on mount)
  console.log('Test 1: Basic search with TransactionType=For Sale');
  try {
    const result = await client.collections('listings').documents().search({
      q: '*',
      query_by: 'UnparsedAddress,City,PropertySubType',
      filter_by: 'TransactionType:For Sale',
      page: 1,
      per_page: 200
    });
    
    console.log(`  Found: ${result.found}`);
    console.log(`  Returned: ${result.hits ? result.hits.length : 0}`);
    
    if (result.hits && result.hits.length > 0) {
      const first = result.hits[0].document;
      console.log('\n  First listing:');
      console.log('    id:', first.id);
      console.log('    address:', first.UnparsedAddress);
      console.log('    location:', JSON.stringify(first.location));
      console.log('    lat/lng valid:', typeof first.location[0] === 'number', typeof first.location[1] === 'number');
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }
  
  console.log('\n=== End Debug ===');
}

debugSearch().catch(console.error);