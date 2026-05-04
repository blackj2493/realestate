/**
 * Shadow MLS - Vault Re-Indexer (Memory-Safe Edition)
 * 
 * Re-indexes ALL listings from Supabase Vault (listings table) into Typesense.
 * Uses cursor-based pagination to handle 90k+ records without V8 OOM crashes.
 * 
 * WARNING: Uses SUPABASE_SERVICE_ROLE_KEY - NEVER expose to frontend!
 * 
 * Run: npx tsx scripts/worker/reindex-from-vault.ts
 */

// MUST set TLS env var BEFORE importing supabase client
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Typesense from 'typesense';
import * as https from 'https';

// Import cross-fetch
import crossFetch from 'cross-fetch';

// Patch global fetch with TLS disabled agent for Supabase client
const agent = new https.Agent({ rejectUnauthorized: false });
const patchedFetch: typeof fetch = (url, init) => {
  return crossFetch(url, {
    ...init,
    // @ts-ignore - agent is not a standard option
    agent
  });
};
(global as unknown as { fetch: typeof fetch }).fetch = patchedFetch;

// ============================================================================
// Configuration
// ============================================================================

const CHUNK_SIZE = 500;  // Strict batch size for memory safety
const TYPESENSE_COLLECTION = 'properties';
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;

// Environment variables
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pyzgnivixhnwzfrdkiq.supabase.co').trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TYPESENSE_ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY || 'B6u0qIHDNhXZH8PMw0E6J5tB5aWvLXCn';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set - cannot proceed without admin access to vault');
  process.exit(1);
}

// Warn about TLS setting if needed
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  console.log('⚠️  TLS certificate verification disabled (corporate proxy mode)');
}

// ============================================================================
// Types
// ============================================================================

interface ListingRecord {
  id: number;
  listing_key: string;
  full_payload: Record<string, unknown>;
  derived_metrics: {
    calculatedDOM: number | null;
    targetGrossYield: number | null;
    isDistressed: boolean;
    hasSecondarySuitePotential: boolean;
  };
  needs_geocoding: boolean;
  city: string | null;
  property_sub_type: string | null;
}

interface TransformResult {
  success: number;
  failed: number;
  failedIds: string[];
  errors: string[];
}

// ============================================================================
// Clients
// ============================================================================

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const typesense = new Typesense.Client({
  nodes: [{
    host: TYPESENSE_HOST,
    port: TYPESENSE_PORT,
    protocol: 'https'
  }],
  apiKey: TYPESENSE_ADMIN_KEY,
  connectionTimeoutSeconds: 30
});

// ============================================================================
// Postal Code Lookup (imported from master library)
// ============================================================================

let postalCodesLoaded = false;

async function ensurePostalCodesLoaded(): Promise<void> {
  if (postalCodesLoaded) return;
  
  try {
    const postalCodes = await import('../../src/lib/postalCodes');
    postalCodes.loadPostalCodes();
    postalCodesLoaded = true;
    console.log('[Reindex] Master postal code library loaded');
  } catch (err) {
    console.error('[Reindex] Failed to load postal codes:', err);
    throw err;
  }
}

// ============================================================================
// Location Resolution (mirrors transformer.ts logic)
// ============================================================================

function resolveLocation(raw: Record<string, unknown>): { location: [number, number]; needsGeocoding: boolean } {
  const FALLBACK_LNG = -79.3832;
  const FALLBACK_LAT = 43.6532;
  
  const postalCode = raw.PostalCode as string | null;
  const apiLat = raw.Latitude as number | null;
  const apiLng = raw.Longitude as number | null;
  
  // Use the require pattern for synchronous access (module is pre-loaded)
  let postalCoords: { lat: number; lng: number } | null = null;
  try {
    // Dynamic require for CommonJS interop
    const postalCodesModule = require('../../src/lib/postalCodes');
    postalCoords = postalCodesModule.getCoordinates(postalCode);
  } catch {
    // Fallback if module not found
  }
  
  if (postalCoords) {
    return {
      location: [postalCoords.lng, postalCoords.lat] as [number, number],
      needsGeocoding: false
    };
  }
  
  // Use API coordinates if available
  if (apiLat !== null && apiLat !== undefined && apiLng !== null && apiLng !== undefined) {
    return {
      location: [apiLng, apiLat] as [number, number],
      needsGeocoding: false
    };
  }
  
  // Final fallback to Toronto
  return {
    location: [FALLBACK_LNG, FALLBACK_LAT] as [number, number],
    needsGeocoding: true
  };
}

// ============================================================================
// Transform a single listing record
// ============================================================================

function transformRecord(record: ListingRecord): Record<string, unknown> | null {
  try {
    const raw = record.full_payload;
    const geo = resolveLocation(raw);
    const metrics = record.derived_metrics || {};
    
    // Build Typesense document (lean format)
    const document: Record<string, unknown> = {
      id: record.listing_key,
      ListPrice: raw.ListPrice ?? 0,
      isDistressed: metrics.isDistressed ?? false,
      hasSecondarySuitePotential: metrics.hasSecondarySuitePotential ?? false,
      location: geo.location
    };
    
    // Add optional fields
    if (raw.UnparsedAddress) document.UnparsedAddress = raw.UnparsedAddress;
    if (raw.City) document.City = raw.City;
    if (raw.BedroomsTotal !== undefined && raw.BedroomsTotal !== null) {
      document.BedroomsTotal = parseInt(String(raw.BedroomsTotal), 10);
    }
    if (raw.BathroomsTotalInteger !== undefined && raw.BathroomsTotalInteger !== null) {
      document.BathroomsTotalInteger = parseFloat(String(raw.BathroomsTotalInteger));
    }
    if (raw.PropertySubType) document.PropertySubType = raw.PropertySubType;
    if (raw.PropertyType) document.PropertyType = raw.PropertyType;
    if (raw.TransactionType) document.TransactionType = raw.TransactionType;
    if (raw.TaxAnnualAmount !== undefined && raw.TaxAnnualAmount !== null) {
      document.TaxAnnualAmount = parseFloat(String(raw.TaxAnnualAmount));
    }
    if (raw.AssociationFee !== undefined && raw.AssociationFee !== null) {
      document.AssociationFee = parseFloat(String(raw.AssociationFee));
    }
    if (raw.LotWidth !== undefined && raw.LotWidth !== null) {
      document.LotWidth = parseFloat(String(raw.LotWidth));
    }
    if (raw.LotDepth !== undefined && raw.LotDepth !== null) {
      document.LotDepth = parseFloat(String(raw.LotDepth));
    }
    if (raw.ApproximateAge) document.ApproximateAge = raw.ApproximateAge;
    if (raw.ParkingTotal !== undefined && raw.ParkingTotal !== null) {
      document.ParkingTotal = raw.ParkingTotal;
    }
    if (raw.BuildingAreaTotal !== undefined && raw.BuildingAreaTotal !== null) {
      document.BuildingAreaTotal = parseFloat(String(raw.BuildingAreaTotal));
    }
    if (metrics.targetGrossYield !== null && metrics.targetGrossYield !== undefined) {
      document.targetGrossYield = metrics.targetGrossYield;
    }
    if (metrics.calculatedDOM !== null && metrics.calculatedDOM !== undefined) {
      document.calculatedDOM = metrics.calculatedDOM;
    }
    if (raw.ListOfficeName) document.ListOfficeName = raw.ListOfficeName;
    if (raw.primaryImageUrl) document.primaryImageUrl = raw.primaryImageUrl;
    
    return document;
  } catch (err) {
    return null;
  }
}

// ============================================================================
// Process a batch with robust error handling
// ============================================================================

async function processBatch(records: ListingRecord[]): Promise<TransformResult> {
  const result: TransformResult = {
    success: 0,
    failed: 0,
    failedIds: [],
    errors: []
  };
  
  // Transform all records first
  const documents: Record<string, unknown>[] = [];
  
  for (const record of records) {
    const doc = transformRecord(record);
    if (doc) {
      documents.push(doc);
      result.success++;
    } else {
      result.failed++;
      result.failedIds.push(record.listing_key);
      result.errors.push(`Transform failed: ${record.listing_key}`);
    }
  }
  
  // Push to Typesense if we have documents
  if (documents.length > 0) {
    try {
      const importResult = await typesense
        .collections(TYPESENSE_COLLECTION)
        .documents()
        .import(documents, { action: 'upsert' });
      
      // Typesense returns array of results for bulk import
      if (Array.isArray(importResult)) {
        importResult.forEach((item, idx) => {
          if (!item.success && item.error) {
            result.failed++;
            result.failedIds.push(documents[idx].id as string);
            result.errors.push(`Typesense error for ${documents[idx].id}: ${item.error}`);
            result.success = Math.max(0, result.success - 1);
          }
        });
      }
    } catch (err) {
      // Network/timeout error - continue to next batch
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`   ⚠️ Typesense import error: ${errorMsg}`);
      result.errors.push(`Batch import failed: ${errorMsg}`);
      result.failed += documents.length;
      result.success = 0;
    }
  }
  
  return result;
}

// ============================================================================
// Cursor-based pagination fetch
// ============================================================================

interface FetchResult {
  records: ListingRecord[];
  lastId: number | null;
  hasMore: boolean;
}

async function fetchChunk(lastId: number | null): Promise<FetchResult> {
  let query = supabase
    .from('listings')
    .select('id, listing_key, full_payload, derived_metrics, needs_geocoding, city, property_sub_type')
    .order('id', { ascending: true })
    .limit(CHUNK_SIZE);
  
  // Cursor-based pagination using ID
  if (lastId !== null) {
    query = query.gt('id', lastId);
  }
  
  const { data, error } = await query;
  
  if (error) {
    throw new Error(`Failed to fetch listings: ${error.message}`);
  }
  
  const records = (data || []) as unknown as ListingRecord[];
  const lastRecordId = records.length > 0 ? records[records.length - 1].id : null;
  
  return {
    records,
    lastId: lastRecordId,
    hasMore: records.length === CHUNK_SIZE
  };
}

// ============================================================================
// Main Re-index Loop
// ============================================================================

async function reindexFromVault(): Promise<void> {
  console.log('\n🚀 Shadow MLS - Vault Re-Indexer (Memory-Safe)');
  console.log('===============================================\n');
  
  console.log('📋 Configuration:');
  console.log(`   Supabase URL: ${SUPABASE_URL.split('//')[1]?.split('.')[0] || 'hidden'}.supabase.co`);
  console.log(`   Chunk size: ${CHUNK_SIZE} records`);
  console.log(`   Typesense collection: ${TYPESENSE_COLLECTION}`);
  console.log('');
  
  // Ensure postal codes are loaded
  await ensurePostalCodesLoaded();
  
  // Count total for progress display
  console.log('🔍 Counting total listings in vault...');
  const { count, error: countError } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true });
  
  if (countError) {
    console.error('❌ Failed to count listings:', countError.message);
    process.exit(1);
  }
  
  const totalRecords = count ?? 0;
  console.log(`   Total listings: ${totalRecords.toLocaleString()}\n`);
  
  if (totalRecords === 0) {
    console.log('✅ No listings to index. Exiting.');
    return;
  }
  
  // ========== MAIN LOOP ==========
  console.log('📦 Starting memory-safe re-index...\n');
  
  let lastId: number | null = null;
  let processedCount = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let batchNumber = 0;
  
  // Create a flag for tracking completion
  let hasMore = true;
  
  while (hasMore) {
    batchNumber++;
    
    // Fetch next chunk using cursor
    let fetchResult: FetchResult;
    try {
      fetchResult = await fetchChunk(lastId);
    } catch (err) {
      console.error(`\n❌ Batch ${batchNumber} fetch failed:`, err);
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }
    
    const { records, lastId: newLastId } = fetchResult;
    lastId = newLastId;
    hasMore = fetchResult.hasMore;
    
    if (records.length === 0) {
      break;
    }
    
    // Process the batch
    let batchResult: TransformResult;
    try {
      batchResult = await processBatch(records);
    } catch (err) {
      console.error(`\n❌ Batch ${batchNumber} processing failed:`, err);
      batchResult = {
        success: 0,
        failed: records.length,
        failedIds: records.map(r => r.listing_key),
        errors: [String(err)]
      };
    }
    
    // Update counters
    processedCount += records.length;
    totalSuccess += batchResult.success;
    totalFailed += batchResult.failed;
    
    // ========== Progress Logging ==========
    const progress = ((processedCount / totalRecords) * 100).toFixed(1);
    const eta = hasMore 
      ? ` (ETA: ~${Math.ceil((totalRecords - processedCount) / CHUNK_SIZE)} batches)`
      : ' (COMPLETE)';
    
    console.log(
      `[Reindex] Processed ${processedCount.toLocaleString()} / ${totalRecords.toLocaleString()}` +
      ` (${progress}%)` +
      ` | Batch ${batchNumber} [+${batchResult.success}${batchResult.failed > 0 ? `,-${batchResult.failed}` : ''}]` +
      eta
    );
    
    // Log errors if any
    if (batchResult.errors.length > 0 && batchResult.errors.length <= 5) {
      batchResult.errors.forEach(e => console.log(`   ⚠️  ${e}`));
    } else if (batchResult.errors.length > 5) {
      console.log(`   ⚠️  ${batchResult.errors.length} errors in batch (truncated)`);
    }
    
    // ========== Memory Cleanup ==========
    // Explicitly clear arrays to help GC
    records.length = 0;
    
    // Small delay between batches to prevent overwhelming the API
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  
  // ========== Summary ==========
  console.log('\n===============================================');
  console.log('📊 Re-Index Complete!');
  console.log('===============================================');
  console.log(`   Batches processed: ${batchNumber}`);
  console.log(`   Total records processed: ${processedCount.toLocaleString()}`);
  console.log(`   Successfully indexed: ${totalSuccess.toLocaleString()}`);
  console.log(`   Failed: ${totalFailed.toLocaleString()}`);
  
  if (totalFailed > 0) {
    console.warn(`\n⚠️  ${totalFailed} records failed. Check logs above.`);
  }
  
  // Verify Typesense count
  try {
    const stats = await typesense.collections(TYPESENSE_COLLECTION).retrieve() as { num_documents: number };
    console.log(`\n✅ Typesense collection contains: ${stats.num_documents.toLocaleString()} documents`);
  } catch (err) {
    console.log('\n⚠️  Could not verify Typesense count');
  }
  
  console.log('\n');
}

// ============================================================================
// Entry Point
// ============================================================================

reindexFromVault()
  .then(() => {
    console.log('[Reindex] Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Re-indexer crashed:', error);
    process.exit(1);
  });