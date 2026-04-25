import 'dotenv/config';

const API_URL = process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata';
const TOKEN = process.env.PROPTX_VOW_TOKEN;

console.log('=== Direct API Test ===');
console.log('URL:', API_URL);
console.log('Token exists:', !!TOKEN);
if (TOKEN) {
  console.log('Token preview:', TOKEN.substring(0, 30) + '...');
}

async function testFetch() {
  console.log('\nFetching...');
  try {
    const response = await fetch(`${API_URL}/Property?$top=1`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/json',
      }
    });
    console.log('Status:', response.status);
    if (response.ok) {
      const data = await response.json();
      console.log('Count:', data['@odata.count'] || 'unknown');
      console.log('Success!');
    } else {
      const text = await response.text();
      console.log('Error:', text.substring(0, 200));
    }
  } catch (err: any) {
    console.log('Fetch error:', err.message);
  }
}

testFetch();