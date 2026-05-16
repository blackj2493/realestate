const Typesense = require('typesense');

const client = new Typesense.Client({
  nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
  apiKey: 'BzXkIss7SXH0U1Hb0a1COwdvEACxbhkj',
  connectionTimeoutSeconds: 5
});

async function testSearch() {
  // This is EXACTLY what the page does in performSearch()
  const filterObj = {
    transactionType: "For Sale",
  };
  
  const filterParts = [];
  
  // Transaction Type filter (same logic as client.ts)
  if (filterObj.transactionType) {
    filterParts.push(`TransactionType:${filterObj.transactionType}`);
  }
  
  console.log('Filter string:', filterParts.join(' && '));
  
  const searchParams = {
    q: '*',
    query_by: 'UnparsedAddress,City,PropertySubType',
    page: 1,
    per_page: 200,
    facet_by: 'City,PropertySubType,PropertyType,TransactionType,ApproximateAge,isDistressed,hasSecondarySuitePotential',
    max_facet_values: 50
  };
  
  if (filterParts.length > 0) {
    searchParams.filter_by = filterParts.join(' && ');
  }
  
  console.log('Search params:', JSON.stringify(searchParams, null, 2));
  
  const response = await client.collections('properties').documents().search(searchParams);
  
  console.log('Result:', {
    totalFound: response.found,
    hits: response.hits?.length,
    processingTimeMs: response.search_time_ms
  });
  
  if (response.hits?.length > 0) {
    console.log('\nFirst hit document:');
    console.log(JSON.stringify(response.hits[0].document, null, 2));
  }
}

testSearch().catch(console.error);