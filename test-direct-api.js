// Test direct API call - no encoding
const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZW5kb3IvdHJyZWIvNjk1OCIsImF1ZCI6IkFtcFVzZXJzUHJkIiwicm9sZXMiOlsiQW1wVmVuZG9yIl0sImlzcyI6InByb2QuYW1wcmUuY2EiLCJleHAiOjI1MzQwMjMwMDc5OSwiaWF0IjoxNzMzNTQyNDI2LCJzdWJqZWN0VHlwZSI6InZlbmRvciIsInN1YmplY3RLZXkiOiI2OTU4IiwianRpIjoiYjg0ZGYwOTUyNDk4NmFkMiIsImN1c3RvbWVyTmFtZSI6InRycmViIn0.q9UI-ib_A3Qu_B8dSO8iQwvz2tRB_qu-ZOrS3tUO3ig';

async function testMedia() {
  const listingKey = 'W9237550';
  
  // Test 1: Direct URL with manual string concatenation (no encoding)
  const url1 = `https://query.ampre.ca/odata/Media?$filter=ResourceRecordKey%20eq%20%27${listingKey}%27&$top=3`;
  
  console.log('Test 1 URL:', url1);
  
  try {
    const response1 = await fetch(url1, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    const data1 = await response1.json();
    console.log('Test 1 Success! Count:', data1.value?.length || 0);
    if (data1.value?.length > 0) {
      console.log('First media URL:', data1.value[0].MediaURL?.substring(0, 60));
    }
  } catch (error) {
    console.log('Test 1 Error:', error.message);
  }
  
  // Test 2: With encodeURIComponent
  const url2 = `https://query.ampre.ca/odata/Media?$filter=${encodeURIComponent(`ResourceRecordKey eq '${listingKey}'`)}&$top=3`;
  
  console.log('\nTest 2 URL:', url2);
  
  try {
    const response2 = await fetch(url2, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    const data2 = await response2.json();
    console.log('Test 2 Success! Count:', data2.value?.length || 0);
  } catch (error) {
    console.log('Test 2 Error:', error.message);
  }
}

testMedia();
