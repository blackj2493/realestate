import 'dotenv/config';

console.log('=== Environment Check ===');
console.log('Token present:', !!process.env.PROPTX_VOW_TOKEN);
if (process.env.PROPTX_VOW_TOKEN) {
  console.log('Token prefix:', process.env.PROPTX_VOW_TOKEN.substring(0, 30) + '...');
}
console.log('API URL:', process.env.AMPRE_API_URL || 'not set');