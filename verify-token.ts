import 'dotenv/config';

// Test with exact token from .env
const TOKEN = process.env.PROPTX_VOW_TOKEN;

async function test() {
  console.log('=== Token Verification ===');
  console.log('Token length:', TOKEN?.length);
  console.log('Token exists:', !!TOKEN);
  
  if (!TOKEN) {
    console.log('ERROR: No token found in .env');
    return;
  }
  
  // Decode JWT to check
  const parts = TOKEN.split('.');
  console.log('JWT parts:', parts.length);
  
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      console.log('JWT payload:', JSON.stringify(payload, null, 2));
    } catch (e) {
      console.log('Could not decode payload');
    }
  }
  
  console.log('\n=== API Test ===');
  try {
    const response = await fetch('https://query.ampre.ca/odata/Property?$top=1', {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/json'
      }
    });
    
    console.log('Response status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ SUCCESS! Count:', data['@odata.count']);
    } else {
      const text = await response.text();
      console.log('❌ FAILED:', text.substring(0, 300));
    }
  } catch (err: any) {
    console.log('Fetch error:', err.message);
  }
}

test();