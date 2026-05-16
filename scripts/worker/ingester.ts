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
// Sold Listing Types
// ============================================================================

interface SoldListingRecord {
  listing_key: string;
  close_price: number;
  close_date: string;
  city_region: string;
  property_sub_type: string;
  bedrooms_above_grade?: number;
  bathrooms_total_integer?: number;
  parking_total?: number;
  interior_score?: number;
  exterior_score?: number;
  basement_score?: number;
  list_price?: number;
  address?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Checks if a listing status indicates it has been sold/closed.
 * Uses standard RESO fields: StandardStatus="Closed" or MlsStatus="Sold"
 */
function isSoldListing(raw: any): boolean {
  const standardStatus = raw.StandardStatus || '';
  const mlStatus = raw.MlsStatus || '';
  
  const isClosed = standardStatus.toLowerCase().trim() === 'closed';
  const isSold = mlStatus.toLowerCase().trim() === 'sold';
  
  return isClosed || isSold;
}

/**
 * Extracts sold listing data from a raw listing for raw_vow_sold table.
 */
function extractSoldListingData(raw: any): SoldListingRecord | null {
  try {
    const status = raw.MlsStatus || raw.StandardStatus || raw.Status;
    
    if (!isSoldListing(status)) {
      return null;
    }

    // Map relevant fields to raw_vow_sold schema
    const record: SoldListingRecord = {
      listing_key: raw.ListingKey || raw.ListingId || '',
      close_price: raw.ClosePrice || raw.ClosePrice || 0,
      close_date: raw.CloseDate || raw.SoldDate || new Date().toISOString(),
      city_region: raw.CityRegion || raw.MarketArea || '',
      property_sub_type: raw.PropertySubType || raw.PropertyType || '',
    };

    // Optional fields for AVM adjustment factors
    if (raw.BedroomsAboveGrade !== undefined) {
      record.bedrooms_above_grade = raw.BedroomsAboveGrade;
    }
    if (raw.BathroomsTotalInteger !== undefined) {
      record.bathrooms_total_integer = raw.BathroomsTotalInteger;
    }
    if (raw.ParkingTotal !== undefined) {
      record.parking_total = raw.ParkingTotal;
    }
    if (raw.InteriorCondition !== undefined) {
      // InteriorScore derived from InteriorCondition (1-5 scale)
      record.interior_score = raw.InteriorCondition;
    }
    if (raw.ExteriorCondition !== undefined) {
      record.exterior_score = raw.ExteriorCondition;
    }
    if (raw.BasementFinishCode !== undefined) {
      record.basement_score = raw.BasementFinishCode;
    }
    if (raw.ListPrice !== undefined) {
      record.list_price = raw.ListPrice;
    }
    if (raw.PropertyAddress || raw.StreetNumber || raw.StreetName) {
      record.address = [raw.StreetNumber, raw.StreetName, raw.UnitNumber].filter(Boolean).join(' ');
    }
    if (raw.City) {
      record.city = raw.City;
    }
    if (raw.StateOrProvince) {
      record.province = raw.StateOrProvince;
    } else {
      record.province = 'ON';
    }
    if (raw.PostalCode) {
      record.postal_code = raw.PostalCode;
    }
    if (raw.Latitude) {
      record.latitude = raw.Latitude;
    }
    if (raw.Longitude) {
      record.longitude = raw.Longitude;
    }

    return record;
  } catch (err) {
    console.warn(`   ⚠️  Failed to extract sold listing data: ${err}`);
    return null;
  }
}

/**
 * Upserts sold listings to raw_vow_sold table.
 * Uses ON CONFLICT (listing_key) DO UPDATE to avoid duplicates.
 */
async function upsertSoldListings(
  supabase: any,
  soldRecords: SoldListingRecord[]
): Promise<{ inserted: number; failed: number; errors: string[] }> {
  if (soldRecords.length === 0) {
    return { inserted: 0, failed: 0, errors: [] };
  }

  console.log(`   🏠 Upserting ${soldRecords.length} sold listings to raw_vow_sold...`);

  const result = { inserted: 0, failed: 0, errors: [] as string[] };

  for (const record of soldRecords) {
    try {
      const { error } = await supabase
        .from('raw_vow_sold')
        .upsert(
          {
            listing_key: record.listing_key,
            close_price: record.close_price,
            close_date: record.close_date,
            city_region: record.city_region,
            property_sub_type: record.property_sub_type,
            bedrooms_above_grade: record.bedrooms_above_grade,
            bathrooms_total_integer: record.bathrooms_total_integer,
            parking_total: record.parking_total,
            interior_score: record.interior_score,
            exterior_score: record.exterior_score,
            basement_score: record.basement_score,
            list_price: record.list_price,
            address: record.address,
            city: record.city,
            province: record.province,
            postal_code: record.postal_code,
            latitude: record.latitude,
            longitude: record.longitude,
          },
          { onConflict: 'listing_key' }
        );

      if (error) {
        result.errors.push(`Failed to upsert ${record.listing_key}: ${error.message}`);
        result.failed++;
      } else {
        result.inserted++;
      }
    } catch (err: any) {
      console.error(`   ❌ Exception upserting ${record.listing_key}: ${err.message}`);
      result.errors.push(`Exception upserting ${record.listing_key}: ${err.message}`);
      result.failed++;
    }
  }

  console.log(`   ✅ raw_vow_sold: ${result.inserted} upserted, ${result.failed} failed`);
  return result;
}

// ============================================================================
// Configuration (sanitized to strip invisible characters)
// ============================================================================

const API_BASE_URL = (process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata').trim();
const BEARER_TOKEN = (process.env.PROPTX_IDX_TOKEN || process.env.PROPTX_VOW_TOKEN || process.env.RESO_BEARER_TOKEN || '').trim();

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
      
      console.log("🔍 DEBUG - Attempting Ampre fetch to URL:", url);
      console.log("🔍 DEBUG - Token exists:", !!process.env.RESO_BEARER_TOKEN);
      
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
      console.error("🚨 FETCH CAUSE:", err.cause || err.message);
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
 * Fetches a batch of ACTIVE listings (max 100) from RESO Web API.
 * Query A of the Dual-Query architecture.
 * 
 * @param skip - Number of records to skip (for manual pagination)
 * @param lastSyncTimestamp - ISO timestamp for ModificationTimestamp filter
 * @returns Listings batch with pagination info
 */
export async function fetchActiveListingsBatch(
  skip: number = 0,
  lastSyncTimestamp?: string
): Promise<ListingsBatch> {
  const token = BEARER_TOKEN;
  
  if (!token) {
    throw new Error('RESO_BEARER_TOKEN environment variable is not set');
  }
  
  if (!lastSyncTimestamp) {
    throw new Error('lastSyncTimestamp must be provided');
  }
  
  // Query A (Active Sync): StandardStatus eq 'Active' + ModificationTimestamp filter
  // Routes to Typesense listings table
  const statusFilter = `StandardStatus eq 'Active'`;
  const modFilter = `ModificationTimestamp gt ${lastSyncTimestamp}`;
  const combinedFilter = `${statusFilter} and (${modFilter})`;
  
  const url = `${API_BASE_URL}/Property?$filter=${encodeURIComponent(combinedFilter)}&$top=100&$skip=${skip}&$count=true`;
  
  console.log(`   🔍 Query A (Active): ${url.substring(0, 80)}...`);
  console.log(`   → Delta query from: ${lastSyncTimestamp} (skip: ${skip})`);
  
  const result = await fetchWithRetry<any>(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    }
  });
  
  if (!result.success || !result.data) {
    throw new Error(`Query A fetch failed: ${result.error}`);
  }
  
  const data = result.data;
  
  // Extract listings and nextLink
  const listings: any[] = data.value || [];
  const nextLink: string | null = data['@odata.nextLink'] || null;
  const totalCount: number | undefined = data['@odata.count'];
  
  console.log(`   ✅ Query A batch received: ${listings.length} listings${nextLink ? ' (more pages)' : ''}`);
  if (totalCount !== undefined) {
    console.log(`   📊 Total matching: ${totalCount}`);
  }
  
  return { listings, nextLink, totalCount };
}

/**
 * Fetches a batch of SOLD/CLOSED listings (max 100) from RESO Web API.
 * Query B of the Dual-Query architecture.
 * 
 * CloseDate is typically a Date string (e.g., "2026-05-14"), not a full ISO timestamp.
 * Uses date string format: CloseDate ge 'YYYY-MM-DD'
 * 
 * @param skip - Number of records to skip (for manual pagination)
 * @param lastSyncDate - Date string (YYYY-MM-DD) for CloseDate filter
 * @returns Listings batch with pagination info
 */
export async function fetchSoldListingsBatch(
  skip: number = 0,
  lastSyncDate?: string
): Promise<ListingsBatch> {
  const token = BEARER_TOKEN;
  
  if (!token) {
    throw new Error('RESO_BEARER_TOKEN environment variable is not set');
  }
  
  if (!lastSyncDate) {
    throw new Error('lastSyncDate must be provided (format: YYYY-MM-DD)');
  }
  
  // Query B (Sold Sync): StandardStatus eq 'Closed' OR MlsStatus eq 'Sold' + CloseDate filter
  // Routes to: raw_vow_sold (AVM anchor) + Typesense (is_sold: true)
  //
  // IMPORTANT: CloseDate is NOT a filterable field on this board's RESO API.
  // Error: "Field not allowed in filter: CloseDate"
  // We can only filter by status. CloseDate data IS present on records (confirmed
  // by diagnostic probe), but the server doesn't allow it in $filter expressions.
  // 
  // Query B must use status-only filter to avoid downloading entire sales history.
  // Add $orderby=CloseDate desc to ensure newest sales come first (for client-side pruning).
  const statusFilter = `(StandardStatus eq 'Closed' or MlsStatus eq 'Sold')`;
  const combinedFilter = statusFilter;
  
  const url = `${API_BASE_URL}/Property?$filter=${encodeURIComponent(combinedFilter)}&$orderby=CloseDate%20desc&$top=100&$skip=${skip}&$count=true`;
  
  console.log(`   🔍 Query B (Sold): ${url.substring(0, 80)}...`);
  console.log(`   → CloseDate filter from: ${lastSyncDate} (skip: ${skip})`);
  
  const result = await fetchWithRetry<any>(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    }
  });
  
  if (!result.success || !result.data) {
    throw new Error(`Query B fetch failed: ${result.error}`);
  }
  
  const data = result.data;
  
  // Extract listings and nextLink
  const listings: any[] = data.value || [];
  const nextLink: string | null = data['@odata.nextLink'] || null;
  const totalCount: number | undefined = data['@odata.count'];
  
  console.log(`   ✅ Query B batch received: ${listings.length} listings${nextLink ? ' (more pages)' : ''}`);
  if (totalCount !== undefined) {
    console.log(`   📊 Total matching: ${totalCount}`);
  }
  
  // Log sample of statuses received
  if (listings.length > 0) {
    const statuses = [...new Set(listings.map(l => l.StandardStatus || l.MlsStatus || l.Status))];
    console.log(`   📋 Statuses in batch: ${statuses.join(', ')}`);
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
      // No row exists - create default (48 hours ago for catch-up)
      console.log('   📝 No sync_state found, initializing with 48h default...');
      const defaultTimestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
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
// Main Delta Sync Orchestrator (Dual-Query Architecture)
// ============================================================================

export interface DualSyncResult {
  success: boolean;
  activeRecords: number;
  soldRecords: number;
  activePages: number;
  soldPages: number;
  errors: string[];
  lastSyncTimestamp: string;
}

/**
 * Executes a Dual-Query delta sync.
 * 
 * Query A (Active Sync):
 *   $filter=StandardStatus eq 'Active' and ModificationTimestamp gt [lastSyncTimestamp]
 *   Routes to: Typesense listings table (via sync.ts)
 * 
 * Query B (Sold Sync):
 *   $filter=(StandardStatus eq 'Closed' or MlsStatus eq 'Sold') and CloseDate ge [lastSyncDate]
 *   Routes to: raw_vow_sold (AVM anchor) + Typesense (is_sold: true) via sync.ts
 * 
 * Algorithm:
 * 1. Read last_sync_timestamp from Supabase
 * 2. Run Query A: Active listings via ModificationTimestamp
 *    a. Paginate through batches
 *    b. Process each batch via sync.ts (Supabase + Typesense)
 *    c. Sleep 1000ms between pages
 * 3. Run Query B: Sold listings via CloseDate (date string format)
 *    a. Paginate through batches
 *    b. Process each batch via sync.ts (Supabase + Typesense with is_sold: true)
 *    c. Extract sold data and UPSERT to raw_vow_sold
 *    d. Sleep 1000ms between pages
 * 4. Update sync_state with current timestamp
 * 
 * IMPORTANT: sync_state is updated ONLY after ALL pages succeed.
 */
export async function runDeltaSync(): Promise<DualSyncResult> {
  console.log('\n========================================');
  console.log('  Shadow MLS - Dual-Query Delta Sync');
  console.log('========================================\n');
  
  const result: DualSyncResult = {
    success: true,
    activeRecords: 0,
    soldRecords: 0,
    activePages: 0,
    soldPages: 0,
    errors: [],
    lastSyncTimestamp: ''
  };
  
  try {
    // Read sync state from Supabase
    console.log('📖 Reading sync state from Supabase...');
    const state = await readSyncState();
    console.log(`   Last sync timestamp: ${state.lastSyncTimestamp}`);
    console.log(`   Status: ${state.status}`);
    
    // Mark as running
    await updateSyncState(state.lastSyncTimestamp, 0, 'running');
    
    // ─── Query A: Active Sync (via ModificationTimestamp) ───────────────────
    console.log('\n════════════════════════════════════════════════');
    console.log('  QUERY A: Active Listings Sync');
    console.log('════════════════════════════════════════════════\n');
    
    let activeSkip = 0;
    let activeHasMore = true;
    let currentTimestamp = state.lastSyncTimestamp;
    
    do {
      console.log(`\n📄 Active Page ${result.activePages + 1} (Skip: ${activeSkip}):`);
      const batch = await fetchActiveListingsBatch(activeSkip, currentTimestamp);
      
      if (batch.listings.length === 0) {
        console.log('   ℹ️  No active listings found in this batch');
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
      result.activeRecords += batch.listings.length;
      result.activePages++;
      activeSkip += batch.listings.length;
      
      // If we got a full batch of 100, there is likely another page
      activeHasMore = batch.listings.length === 100;
      
      console.log(`   📊 Running totals: ${result.activeRecords} active records, ${result.activePages} pages`);
      
      // Rate limit delay
      console.log(`   ⏳ Rate limiting: sleeping ${PAGE_DELAY_MS}ms...`);
      await sleep(PAGE_DELAY_MS);
      
    } while (activeHasMore);
    
    console.log(`\n✅ Query A Complete: ${result.activeRecords} active records, ${result.activePages} pages`);
    
    // ─── Query B: Sold Sync (via CloseDate) ──────────────────────────────────
    console.log('\n════════════════════════════════════════════════');
    console.log('  QUERY B: Sold Listings Sync');
    console.log('════════════════════════════════════════════════\n');
    
    // Convert timestamp to date string for CloseDate filter (YYYY-MM-DD format)
    // CloseDate is typically just a Date string, not full ISO timestamp
    const lastSyncDate = state.lastSyncTimestamp.split('T')[0] || state.lastSyncTimestamp.substring(0, 10);
    console.log(`   📅 Using lastSyncDate: ${lastSyncDate} (date string format for CloseDate filter)`);
    
    let soldSkip = 0;
    let soldHasMore = true;
    const supabaseClient = getServiceRoleClient();
    
    do {
      console.log(`\n📄 Sold Page ${result.soldPages + 1} (Skip: ${soldSkip}):`);
      const batch = await fetchSoldListingsBatch(soldSkip, lastSyncDate);
      
      if (batch.listings.length === 0) {
        console.log('   ℹ️  No sold listings found in this batch');
        break;
      }
      
      // Log sample statuses
      const statuses = [...new Set(batch.listings.map(l => l.StandardStatus || l.MlsStatus || l.Status))];
      console.log(`   📋 Statuses in batch: ${statuses.join(', ')}`);
      
      // Process batch through ETL pipeline (sync.ts) with is_sold flag
      console.log('   🔄 Processing sold batch through ETL pipeline...');
      const syncResult = await processBatch(batch.listings, { isSold: true });
      
      if (!syncResult.success) {
        result.errors.push(...syncResult.supabase.errors);
        result.errors.push(...syncResult.typesense.errors);
      }
      
      // Extract sold data for raw_vow_sold (AVM anchor table)
      const soldRecords: SoldListingRecord[] = [];
      for (const rawListing of batch.listings) {
        const soldData = extractSoldListingData(rawListing);
        if (soldData) {
          soldRecords.push(soldData);
        }
      }
      
      if (soldRecords.length > 0) {
        console.log(`   🏠 Found ${soldRecords.length} sold/closed listings for raw_vow_sold`);
        const upsertResult = await upsertSoldListings(supabaseClient, soldRecords);
        console.log(`   📊 raw_vow_sold upsert result: ${JSON.stringify(upsertResult)}`);
      }
      
      // ─── Client-Side Pruning (CloseDate guard) ─────────────────────────────
      // Since CloseDate cannot be used in $filter (board rejects it), we use
      // server-side sorting ($orderby=CloseDate desc) + client-side pruning.
      // Once we hit a CloseDate older than our cutoff, everything after is older.
      const cutoffDate = new Date(lastSyncDate);
      let hitOldCutoff = false;
      
      for (const listing of batch.listings) {
        const closeDate = listing.CloseDate || listing.SoldDate;
        if (closeDate) {
          const listingDate = new Date(closeDate);
          if (listingDate < cutoffDate) {
            console.log(`   🛑 Client-side pruning: Found CloseDate ${closeDate} older than cutoff ${lastSyncDate}`);
            console.log(`   🛑 Aborting pagination - all subsequent listings will be older (sorted desc)`);
            hitOldCutoff = true;
            break;
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────────
      
      // Update counters
      result.soldRecords += batch.listings.length;
      result.soldPages++;
      soldSkip += batch.listings.length;
      
      // If we got a full batch of 100, there is likely another page
      // BUT also check if we hit the old cutoff date
      soldHasMore = !hitOldCutoff && batch.listings.length === 100;
      
      console.log(`   📊 Running totals: ${result.soldRecords} sold records, ${result.soldPages} pages`);
      
      // Rate limit delay
      console.log(`   ⏳ Rate limiting: sleeping ${PAGE_DELAY_MS}ms...`);
      await sleep(PAGE_DELAY_MS);
      
    } while (soldHasMore);
    
    console.log(`\n✅ Query B Complete: ${result.soldRecords} sold records, ${result.soldPages} pages`);
    
    // ─── Finalize ───────────────────────────────────────────────────────────
    const now = new Date().toISOString();
    result.lastSyncTimestamp = now;
    
    console.log('\n========================================');
    console.log('  Dual-Query Sync Complete!');
    console.log('========================================');
    console.log(`   Active records: ${result.activeRecords} (${result.activePages} pages)`);
    console.log(`   Sold records: ${result.soldRecords} (${result.soldPages} pages)`);
    console.log(`   New sync timestamp: ${now}`);
    
    if (result.errors.length > 0) {
      console.log(`   ⚠️  Warnings: ${result.errors.length} errors`);
      result.errors.slice(0, 5).forEach(e => console.log(`     - ${e}`));
    }
    
    // Update sync state with new timestamp
    await updateSyncState(now, result.activeRecords + result.soldRecords, 'completed');
    
    return result;
    
  } catch (err: any) {
    console.error('\n❌ Dual-Query sync failed:', err.message);
    result.success = false;
    result.errors.push(err.message);
    
    // Update status to failed
    await updateSyncState(new Date().toISOString(), result.activeRecords + result.soldRecords, 'failed');
    
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
    
    const batch = await fetchActiveListingsBatch(
      0,
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