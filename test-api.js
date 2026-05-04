const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/api/properties/listings?type=buy',
  method: 'GET',
  timeout: 25000
}, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const j = JSON.parse(data);
      console.log('Listings:', j.listings ? 'count:' + j.listings.length : 'undefined');
      if (j.error) console.log('Error:', j.error);
      if (j.pagination) console.log('Total:', j.pagination.total);
    } catch(e) {
      console.log('Parse:', e.message);
      console.log('Raw:', data.substring(0, 200));
    }
  });
});

req.on('error', e => console.log('E:', e.message));
req.on('timeout', () => { console.log('Timeout'); req.destroy(); });
req.end();