// Test the ProptX VOW API directly
const fetch = require('node-fetch');

const VOW_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZW5kb3IvdHJyZWIvNjk1OCIsImF1ZCI6IkFtcFVzZXJzUHJkIiwicm9sZSI6WyJBbXBWZW5kb3IiXSwiaXNzIjoicHJvZC5hbXByZS5jYSIsImV4cCI6MjUzNDAyMzAwNzk5LCJpYXQiOjE3MzM1NDI0MjYsInN1YmplY3RUeXBlIjoidmVuZG9yIiwic3ViamVjdEtleSI6IjY5NTgiLCJqdGkiOiJiODRkZjA5NTI0OTg2YWQyIiwiY3VzdG9tZXJOYW1lIjoidHJyZWIifQ.q9UI-ib_A3Qu_B8dSO8iQwvz2tRB_qu-ZOrS3tUO3ig';

const API_BASE = 'https://query.ampre.ca/odata';

async function testVOW() {
  console.log('Testing VOW API...\n');
  
  // Test 1: Get properties
  console.log('Test 1: GET /Property?$top=2');
  try {
    const url = `${API_BASE}/Property?$top=2`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${VOW_TOKEN}`,
        'Accept': 'application/json'
      }
    });
    console.log('Status:', resp.status);
    const data = await resp.json();
    console.log('Keys:', Object.keys(data));
    if (data.value) {
      console.log('Count:', data.value.length);
      if (data.value.length > 0) {
        console.log('First property keys:', Object.keys(data.value[0]));
        console.log('First property TransactionType:', data.value[0].TransactionType);
      }
    } else {
      console.log('Response:', JSON.stringify(data).substring(0, 500));
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
  
  // Test 2: Check count
  console.log('\nTest 2: GET /Property?$top=0&$count=true');
  try {
    const url = `${API_BASE}/Property?$top=0&$count=true`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${VOW_TOKEN}`,
        'Accept': 'application/json'
      }
    });
    console.log('Status:', resp.status);
    const data = await resp.json();
    console.log('@odata.count:', data['@odata.count']);
  } catch (err) {
    console.error('Error:', err.message);
  }
  
  // Test 3: Filter by TransactionType
  console.log('\nTest 3: GET /Property?$filter=TransactionType eq \'For Sale\'&$top=2');
  try {
    const url = `${API_BASE}/Property?$filter=TransactionType eq 'For Sale'&$top=2`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${VOW_TOKEN}`,
        'Accept': 'application/json'
      }
    });
    console.log('Status:', resp.status);
    const data = await resp.json();
    if (data.value) {
      console.log('Count:', data.value.length);
    } else {
      console.log('Response:', JSON.stringify(data).substring(0, 500));
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testVOW().catch(console.error);