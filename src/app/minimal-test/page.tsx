export default function MinimalTest() {
  return (
    <div>
      <h1>Minimal Test</h1>
      <p id="data">Loading...</p>
      <script dangerouslySetInnerHTML={{
        __html: `
          (async function() {
            try {
              const Typesense = window.Typesense;
              // Wait for Typesense to load
              await new Promise(r => setTimeout(r, 1000));
              
              const client = new Typesense.Client({
                nodes: [{
                  host: '9uyapwh6e5qmvl34p-1.a1.typesense.net',
                  port: 443,
                  protocol: 'https'
                }],
                apiKey: 'BzXkIss7SXH0U1Hb0a1COwdvEACxbhkj'
              });
              
              const response = await client.collections('listings').documents().search({
                q: '*',
                filter_by: 'TransactionType:For Sale',
                per_page: 5
              });
              
              document.getElementById('data').innerHTML = 
                'Found: ' + response.found + 
                ', Hits: ' + response.hits.length;
            } catch(e) {
              document.getElementById('data').innerHTML = 'Error: ' + e.message;
            }
          })();
        `
      }} />
    </div>
  );
}