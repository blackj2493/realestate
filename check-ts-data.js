const T = require('typesense');
const c = new T.Client({
  nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
  apiKey: 'BzXkIss7SXH0U1Hb0a1COwdvEACxbhkj'
});

(async () => {
  console.log('Running search test...');
  
  // Simulate what the page does
  const r = await c.collections('properties').documents().search({
    q: '*',
    query_by: 'UnparsedAddress,City,PropertySubType',
    page: 1,
    per_page: 200,
    filter_by: 'TransactionType:For Sale'
  });
  
  console.log('Total found:', r.found);
  console.log('Hits returned:', r.hits ? r.hits.length : 0);
  
  // Check location data
  let validLoc = 0;
  let invalidLoc = 0;
  if (r.hits) {
    r.hits.forEach(h => {
      const loc = h.document.location;
      if (loc && Array.isArray(loc) && loc.length === 2 && typeof loc[0] === 'number' && typeof loc[1] === 'number') {
        validLoc++;
      } else {
        invalidLoc++;
        if (invalidLoc <= 3) console.log('Invalid loc:', JSON.stringify(loc), 'id:', h.document.id);
      }
    });
  }
  console.log('Valid location:', validLoc, 'Invalid location:', invalidLoc);
  
  // Check first 3 documents
  if (r.hits && r.hits.length > 0) {
    console.log('\nFirst doc keys:', Object.keys(r.hits[0].document).join(', '));
    console.log('First doc location:', JSON.stringify(r.hits[0].document.location));
  }
  
  console.log('\nDone!');
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});