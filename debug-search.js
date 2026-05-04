const Typesense = require('typesense');
const client = new Typesense.Client({
  nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
  apiKey: 'BzXkIss7SXH0U1Hb0a1COwdvEACxbhkj'
});

async function test() {
  try {
    console.log('Searching Typesense...');
    const result = await client.collections('listings').documents().search({
      q: '*',
      query_by: 'UnparsedAddress,City',
      per_page: 5
    });
    console.log('Found:', result.found);
    console.log('Hits:', result.hits ? result.hits.length : 0);
    if (result.hits && result.hits.length > 0) {
      console.log('First doc:', JSON.stringify(result.hits[0].document).substring(0, 500));
    }
  } catch(e) {
    console.error('Search error:', e.message);
  }
}
test();