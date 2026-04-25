import 'dotenv/config';

function decodeJWT(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64').toString());
  } catch {
    return null;
  }
}

console.log('=== Comparing Tokens ===\n');

const tokens = {
  'PROPTX_IDX_TOKEN': process.env.PROPTX_IDX_TOKEN,
  'PROPTX_VOW_TOKEN': process.env.PROPTX_VOW_TOKEN,
  'PROPTX_DLA_TOKEN': process.env.PROPTX_DLA_TOKEN,
};

for (const [name, token] of Object.entries(tokens)) {
  console.log(`${name}:`);
  if (!token) {
    console.log('  Not configured');
  } else {
    const payload = decodeJWT(token);
    if (payload) {
      console.log('  sub:', payload.sub);
      console.log('  aud:', payload.aud);
      console.log('  roles:', payload.role);
      console.log('  iat:', new Date(payload.iat * 1000).toISOString());
    } else {
      console.log('  Invalid JWT format');
    }
  }
  console.log('');
}

console.log('=== Testing All Tokens ===\n');

async function testToken(name: string, token: string | undefined) {
  if (!token) {
    console.log(`${name}: Not configured`);
    return;
  }
  
  try {
    const response = await fetch('https://query.ampre.ca/odata/Property?$top=1', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    
    console.log(`${name}: Status ${response.status} ${response.ok ? '✅' : '❌'}`);
  } catch (err: any) {
    console.log(`${name}: Error - ${err.message}`);
  }
}

(async () => {
  await testToken('PROPTX_IDX_TOKEN', process.env.PROPTX_IDX_TOKEN);
  await testToken('PROPTX_VOW_TOKEN', process.env.PROPTX_VOW_TOKEN);
  await testToken('PROPTX_DLA_TOKEN', process.env.PROPTX_DLA_TOKEN);
})();