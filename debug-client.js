// Test script to check if the browser-side Typesense search works
// This simulates what the properties page does

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const SEARCH_API_KEY = 'BzXkIss7SXH0U1Hb0a1COwdvEACxbhkj';

async function testBrowserSearch() {
  console.log('Testing browser-side Typesense search...');
  console.log('Host:', TYPESENSE_HOST);
  console.log('Port:', TYPESENSE_PORT);
  
  // Build URL like browser would
  const url = `https://${TYPESENSE_HOST}:${TYPESENSE_PORT}/collections/listings/documents/search?q=*&query_by=UnparsedAddress,City,PropertySubType&filter_by=TransactionType:For Sale&page=1&per_page=200`;
  
  console.log('\nURL:', url);
  
  // Try fetch
  try {
    console.log('\nAttempting fetch...');
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-TYPESENSE-API-KEY': SEARCH_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Status:', response.status);
    const data = await response.json();
    console.log('Found:', data.found);
    console.log('Hits:', data.hits ? data.hits.length : 0);
  } catch(e) {
    console.log('Fetch error:', e.message);
  }
}

testBrowserSearch();