const Typesense = require('typesense');

const client = new Typesense.Client({
  nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
  apiKey: 'BzXkIss7SXH0U1Hb0a1COwdvEACxbhkj',
  connectionTimeoutSeconds: 5
});

async function test() {
  try {
    // Test 1: No filters - just query all
    console.log('Test 1: Query all with *');
    const r1 = await client.collections('properties').documents().search({
      q: '*',
      per_page: 3
    });
    console.log('Found:', r1.found, 'hits:', r1.hits?.length);
    if (r1.hits?.length) {
      console.log('First doc keys:', Object.keys(r1.hits[0].document));
      console.log('TransactionType:', r1.hits[0].document.TransactionType);
    }
    
    // Test 2: With TransactionType filter
    console.log('\nTest 2: With TransactionType: For Sale');
    const r2 = await client.collections('properties').documents().search({
      q: '*',
      filter_by: 'TransactionType:For Sale',
      per_page: 3
    });
    console.log('Found:', r2.found, 'hits:', r2.hits?.length);
    
    // Test 3: Check distinct TransactionType values using facets
    console.log('\nTest 3: Facets on TransactionType');
    const r3 = await client.collections('properties').documents().search({
      q: '*',
      facet_by: 'TransactionType',
      max_facet_values: 10
    });
    console.log('Facets:', JSON.stringify(r3.facet_distribution?.TransactionType, null, 2));
    
    // Test 4: Check PropertySubType facets
    console.log('\nTest 4: Facets on PropertySubType');
    const r4 = await client.collections('properties').documents().search({
      q: '*',
      facet_by: 'PropertySubType',
      max_facet_values: 20
    });
    console.log('PropertySubType facets:', JSON.stringify(r4.facet_distribution?.PropertySubType, null, 2));
    
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();