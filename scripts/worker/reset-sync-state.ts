import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const client = createClient(supabaseUrl, supabaseKey);

async function resetSyncState() {
  console.log('🔄 Resetting sync_state to start fresh from page 1...\n');
  
  // Get current state
  const { data: currentState } = await client
    .from('sync_state')
    .select('*')
    .eq('id', 'master')
    .single();
    
  if (currentState) {
    console.log('Current state:', JSON.stringify(currentState, null, 2));
  }
  
  // Reset to a timestamp 48 hours ago so it catches up on recent data
  const defaultTimestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  
  const { data, error } = await client
    .from('sync_state')
    .upsert({ 
      id: 'master', 
      last_sync_timestamp: defaultTimestamp, 
      status: 'idle',
      sync_type: 'full',
      records_synced: 0
    }, { onConflict: 'id' })
    .select()
    .single();
    
  if (error) {
    console.error('❌ Failed to reset sync state:', error);
    process.exit(1);
  }
  
  console.log('\n✅ Sync state reset successfully!');
  console.log('New state:', JSON.stringify(data, null, 2));
  console.log('\n📝 The sync will now start fresh from page 1.');
  console.log('   It will catch up on listings from the last 48 hours.');
}

resetSyncState().catch(console.error);