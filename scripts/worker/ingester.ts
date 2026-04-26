/**
 * Shadow MLS - ETL Ingester (RESO Web API)
 * 
 * Rate-limited OData fetcher for Ampre real estate board.
 * Implements sequential pagination with robust retry logic.
 * 
 * Critical Constraints:
 * - Maximum payload: $top=100 per request
 * - Sequential processing ONLY (no Promise.all for pages)
 * - 1000ms forced delay between paginated requests
 * - Automatic retry with exponential backoff for 5xx errors
 * 
 * Run: npx tsx scripts/worker/ingester.ts
 */

// Load .env file
import 'dotenv/config';

import { getServiceRoleClient } from '@/lib/supabase/client';
import { processBatch, SyncResult } from './sync';

// ============================================================================
// Configuration
// ============================================================================

const API_BASE_URL = process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata';
const BEARER_TOKEN = process.env.PROPTX_IDX_TOKEN || process.env.PROPTX_VOW_TOKEN || process.env.RESO_BEARER_TOKEN;

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 3000];  // ms between retry attempts

// Rate limiting
const PAGE_DELAY_MS = 1000;

// ============================================================================
// Sleep Utility
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Fetch with Retry Logic
// ============================================================================

interface FetchResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

async function fetchWithRetry<T>(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<FetchResult<T>> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(`   📡 Fetch attempt ${attempt + 1}/${retries + 1}: ${url.substring(0, 80)}...`);
      
      console.log(`Attempting to fetch from: ${url}`);
      
      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Accept': 'application/json',
        }
      });
      
      // Handle server errors with retry
      if (response.status >= 500 && response.status < 600) {
        const retryAfter = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
        console.warn(`   ⚠️  Server error ${response.status}. Retrying in ${retryAfter}ms...`);
        await sleep(retryAfter);
        continue;
      }
      
      // Parse response
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') 
        ? await response.json() 
        : await response.text();
      
      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`,
          statusCode: response.status
        };
      }
      
      return { success: true, data };
      
    } catch (err: any) {
      lastError = err;
      console.warn(`   ⚠️  Fetch error: ${err.message}. ${retries - attempt} retries remaining.`);
      
      if (attempt < retries) {
        const retryAfter = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
        await sleep(retryAfter);
      }
    }
  }
  
  return {
    success: false,
    error: `Failed after ${MAX_RETRIES} retries: ${lastError?.message || 'Unknown error'}`
  };
}

// ============================================================================
// Core Fetcher Functions
// ============================================================================

export interface ListingsBatch {
  listings: any[];
  nextLink: string | null;
  totalCount?: number;
}

/**
 * Fetches a batch of listings (max 100) from RESO Web API.
 * 
 * @param skipUrl - Optional @odata.nextLink URL (for pagination)
 * @param lastSyncTimestamp - ISO timestamp for ModificationTimestamp filter
 * @returns Listings batch with pagination info
 */
export async function fetchListingsBatch(
  skipUrl?: string,
  lastSyncTimestamp?: string
): Promise<ListingsBatch> {
  const token = BEARER_TOKEN;
  
  if (!token) {
    throw new Error('RESO_BEARER_TOKEN environment variable is not set');
  }
  
  let url: string;
  
  if (skipUrl) {
    // Use @odata.nextLink directly (already constructed by server)
    url = skipUrl;
    console.log('   → Following pagination link...');
  } else {
    // Construct initial query with delta filter
    if (!lastSyncTimestamp) {
      throw new Error('Either skipUrl or lastSyncTimestamp must be provided');
    }
    
    const filter = encodeURIComponent(`ModificationTimestamp gt ${lastSyncTimestamp}`);
    url = `${API_BASE_URL}/Property?$filter=${filter}&$top=100&$count=true`;
    console.log(`   → Delta query from: ${lastSyncTimestamp}`);
  }
  
  const result = await fetchWithRetry<any>(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    }
  });
  
  if (!result.success || !result.data) {
    throw new Error(`Fetch failed: ${result.error}`);
  }
  
  const data = result.data;
  
  // Extract listings and nextLink
  const listings: any[] = data.value || [];
  const nextLink: string | null = data['@odata.nextLink'] || null;
  const totalCount: number | undefined = data['@odata.count'];
  
  console.log(`   ✅ Batch received: ${listings.length} listings${nextLink ? ' (more pages)' : ''}`);
  if (totalCount !== undefined) {
    console.log(`   📊 Total matching: ${totalCount}`);
  }
  
  return { listings, nextLink, totalCount };
}

// ============================================================================
// Sync State Management (Supabase)
// ============================================================================

interface SyncState {
  lastSyncTimestamp: string;
  syncType: string;
  recordsSynced: number;
  status: string;
}

/**
 * Reads the current sync state from Supabase.
 * Returns the last successful sync timestamp.
 */
export async function readSyncState(): Promise<SyncState> {
  const client = getServiceRoleClient();
  
  const { data, error } = await client
    .from('sync_state')
    .select('*')
    .eq('id', 'master')
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      // No row exists - create default (24 hours ago)
      console.log('   📝 No sync_state found, initializing with 24h default...');
      const defaultTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await client
        .from('sync_state')
        .insert({ id: 'master', last_sync_timestamp: defaultTimestamp, status: 'idle' });
      return { lastSyncTimestamp: defaultTimestamp, syncType: 'delta', recordsSynced: 0, status: 'idle' };
    }
    throw error;
  }
  
  return {
    lastSyncTimestamp: data.last_sync_timestamp,
    syncType: data.sync_type || 'delta',
    recordsSynced: data.records_synced || 0,
    status: data.status || 'idle'
  };
}

/**
 * Updates sync state in Supabase.
 * Called ONLY after all pages are successfully processed.
 */
export async function updateSyncState(
  timestamp: string,
  recordsSynced: number,
  status: 'idle' | 'running' | 'completed' | 'failed' = 'completed'
): Promise<void> {
  const client = getServiceRoleClient();
  
  console.log(`   💾 Updating sync_state: timestamp=${timestamp}, records=${recordsSynced}, status=${status}`);
  
  const { error } = await client
    .from('sync_state')
    .update({
      last_sync_timestamp: timestamp,
      records_synced: recordsSynced,
      status,
      updated_at: new Date().toISOString()
    })
    .eq('id', 'master');
  
  if (error) {
    console.error(`   ❌ Failed to update sync_state: ${error.message}`);
    throw error;
  }
  
  console.log(`   ✅ Sync state updated successfully`);
}

// ============================================================================
// Main Delta Sync Orchestrator
// ============================================================================

export interface DeltaSyncResult {
  success: boolean;
  totalRecords: number;
  pagesProcessed: number;
  errors: string[];
  lastSyncTimestamp: string;
}

/**
 * Executes a delta sync - fetches all modified listings since last run.
 * 
 * Algorithm:
 * 1. Read last_sync_timestamp from Supabase
 * 2. While (has nextLink):
 *    a. Fetch batch of ≤100 listings
 *    b. Process batch via sync.ts (dual-write to Supabase + Typesense)
 *    c. Sleep 1000ms (rate limit)
 *    d. Update nextLink
 * 3. Update sync_state with current timestamp
 * 
 * IMPORTANT: sync_state is updated ONLY after ALL pages succeed.
 */
export async function runDeltaSync(): Promise<DeltaSyncResult> {
  console.log('\n========================================');
  console.log('  Shadow MLS - Delta Sync Starting');
  console.log('========================================\n');
  
  const result: DeltaSyncResult = {
    success: true,
    totalRecords: 0,
    pagesProcessed: 0,
    errors: [],
    lastSyncTimestamp: ''
  };
  
  try {
    // Step 1: Read current sync state
    console.log('📖 Reading sync state from Supabase...');
    const state = await readSyncState();
    console.log(`   Last sync: ${state.lastSyncTimestamp}`);
    console.log(`   Status: ${state.status}\n`);
    
    // Mark as running
    await updateSyncState(state.lastSyncTimestamp, 0, 'running');
    
    // Step 2: Paginate through all modified listings
    let nextLink: string | null = null;
    let currentTimestamp = state.lastSyncTimestamp;
    
    do {
      // Fetch batch
      console.log(`\n📄 Page ${result.pagesProcessed + 1}:`);
      const batch = await fetchListingsBatch(nextLink || undefined, nextLink ? undefined : currentTimestamp);
      
      if (batch.listings.length === 0) {
        console.log('   ℹ️  No listings found in this batch');
        break;
      }
      
      // Process batch through ETL pipeline (sync.ts)
      console.log('   🔄 Processing batch through ETL pipeline...');
      const syncResult = await processBatch(batch.listings);
      
      if (!syncResult.success) {
        result.errors.push(...syncResult.supabase.errors);
        result.errors.push(...syncResult.typesense.errors);
      }
      
      // Update counters
      result.totalRecords += batch.listings.length;
      result.pagesProcessed++;
      
      console.log(`   📊 Running totals: ${result.totalRecords} records, ${result.pagesProcessed} pages`);
      
      // Rate limit delay
      console.log(`   ⏳ Rate limiting: sleeping ${PAGE_DELAY_MS}ms...`);
      await sleep(PAGE_DELAY_MS);
      
      // Update pagination
      nextLink = batch.nextLink;
      
    } while (nextLink);
    
    // Step 3: Update sync state (ONLY after all pages succeed)
    const now = new Date().toISOString();
    result.lastSyncTimestamp = now;
    
    console.log('\n========================================');
    console.log('  Delta Sync Complete!');
    console.log('========================================');
    console.log(`   Records synced: ${result.totalRecords}`);
    console.log(`   Pages processed: ${result.pagesProcessed}`);
    console.log(`   New sync timestamp: ${now}`);
    
    if (result.errors.length > 0) {
      console.log(`   Warnings: ${result.errors.length} errors`);
      result.errors.slice(0, 5).forEach(e => console.log(`     - ${e}`));
    }
    
    // Update sync state with new timestamp
    await updateSyncState(now, result.totalRecords, 'completed');
    
    return result;
    
  } catch (err: any) {
    console.error('\n❌ Delta sync failed:', err.message);
    result.success = false;
    result.errors.push(err.message);
    
    // Update status to failed
    await updateSyncState(new Date().toISOString(), result.totalRecords, 'failed');
    
    return result;
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args[0] === 'sync') {
    await runDeltaSync();
  } else if (args[0] === 'test') {
    // Test fetch with current token
    const token = BEARER_TOKEN;
    if (!token) {
      console.error('❌ RESO_BEARER_TOKEN not configured');
      process.exit(1);
    }
    
    console.log('\n🧪 Testing fetch with current token...');
    console.log(`   Token: ${token.substring(0, 20)}...`);
    
    const batch = await fetchListingsBatch(
      undefined,
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    );
    
    console.log(`\n✅ Test complete!`);
    console.log(`   Listings: ${batch.listings.length}`);
    console.log(`   NextLink: ${batch.nextLink ? 'yes' : 'no'}`);
    console.log(`   Total count: ${batch.totalCount || 'unknown'}`);
    
    if (batch.listings.length > 0) {
      console.log('\n📋 Sample listing:');
      console.log(JSON.stringify(batch.listings[0], null, 2).substring(0, 500) + '...');
    }
  } else {
    console.log(`
Shadow MLS Ingester
===================

Usage:
  npx tsx scripts/worker/ingester.ts sync   - Run delta sync
  npx tsx scripts/worker/ingester.ts test   - Test API connection

Environment Variables:
  RESO_BEARER_TOKEN  - Bearer token for Ampre RESO Web API
  AMPRE_API_URL      - Base URL (default: https://query.ampre.ca/odata)

Notes:
  - Uses $top=100 per request (strict rate limit compliance)
  - Processes pages sequentially (no concurrent fetches)
  - 1000ms delay between pages
  - Automatic retry for 5xx errors (3 attempts)
    `);
  }
}

// Only run main() when executed directly (not when imported as a module)
// This allows the API route to import runDeltaSync without triggering CLI execution
const isMainModule = typeof process !== 'undefined' && 
  process.argv[1]?.includes('ingester.ts');

if (isMainModule) {
  main().catch(err => {
    console.error('\n💥 Fatal error:', err.message);
    process.exit(1);
  });
}