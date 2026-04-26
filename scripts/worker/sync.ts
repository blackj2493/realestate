/**
 * Shadow MLS - ETL Sync Orchestrator
 * 
 * Dual-write database orchestrator that routes transformed listings
 * to both Supabase (storage) and Typesense (search).
 * 
 * Run: npx tsx scripts/worker/sync.ts
 */

import { getServiceRoleClient } from '@/lib/supabase/client';
import { transformListing, TransformResult } from './transformer';
import Typesense, { Client } from 'typesense';

// ============================================================================
// Configuration
// ============================================================================

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const TYPESENSE_ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY || 'Ke8EhmC9c1Qm6JbttPt0rzSnvXa26Yxy';

// Batch size for database operations
const BATCH_SIZE = 100;

// ============================================================================
// Typesense Client (Admin - for writes)
// ============================================================================

let adminClient: Client | null = null;

function getAdminClient(): Client {
  if (!adminClient) {
    adminClient = new Typesense.Client({
      nodes: [
        {
          host: TYPESENSE_HOST,
          port: TYPESENSE_PORT,
          protocol: 'https'
        }
      ],
      apiKey: TYPESENSE_ADMIN_KEY,
      connectionTimeoutSeconds: 10
    });
  }
  return adminClient;
}

// ============================================================================
// Sync Functions
// ============================================================================

export interface SyncResult {
  success: boolean;
  supabase: {
    inserted: number;
    failed: number;
    errors: string[];
  };
  typesense: {
    indexed: number;
    failed: number;
    errors: string[];
  };
}

/**
 * Process a batch of raw listings through the ETL pipeline.
 * 
 * Steps:
 * 1. Transform each raw listing using transformListing()
 * 2. Separate results into supabaseBatch and typesenseBatch
 * 3. Write to Supabase (storage)
 * 4. Write to Typesense (search index)
 */
export async function processBatch(rawListings: any[]): Promise<SyncResult> {
  console.log(`\n📦 Processing batch of ${rawListings.length} listings...`);
  
  const result: SyncResult = {
    success: true,
    supabase: { inserted: 0, failed: 0, errors: [] },
    typesense: { indexed: 0, failed: 0, errors: [] }
  };

  // Step 1: Transform all listings
  const transformed = rawListings.map(raw => transformListing(raw));
  
  // Step 2: Separate into batches
  const supabaseRecords = transformed.map(t => t.supabasePayload);
  const typesenseDocuments = transformed.map(t => t.typesensePayload);

  // Step 3: Write to Supabase (storage)
  console.log('💾 Writing to Supabase...');
  try {
    const supabaseClient = getServiceRoleClient();
    
    // Batch upsert to Supabase
    const { data, error } = await supabaseClient
      .from('listings')
      .upsert(supabaseRecords, { onConflict: 'listing_key' })
      .select('id');
    
    if (error) {
      result.supabase.errors.push(error.message);
      result.supabase.failed = rawListings.length;
      result.success = false;
      console.error('❌ Supabase upsert failed:', error.message);
    } else {
      result.supabase.inserted = data?.length || supabaseRecords.length;
      console.log(`   ✅ Supabase: ${result.supabase.inserted} records upserted`);
    }
  } catch (err: any) {
    result.supabase.errors.push(err.message);
    result.supabase.failed = rawListings.length;
    result.success = false;
    console.error('❌ Supabase error:', err.message);
  }

  // Step 4: Write to Typesense (search index)
  console.log('🔍 Writing to Typesense...');
  try {
    const client = getAdminClient();
    
    // Use import endpoint with upsert action
    // This is more efficient than individual upserts
    const importResponse = await client
      .collections('listings')
      .documents()
      .import(typesenseDocuments, { action: 'upsert' });
    
    // Typesense import returns array of results
    const importResults = Array.isArray(importResponse) 
      ? importResponse 
      : JSON.parse(importResponse as unknown as string);
    
    let successCount = 0;
    let failCount = 0;
    
    // Log detailed per-document errors
    const failedDocuments: string[] = [];
    
    for (const res of importResults) {
      if (res.success !== undefined && res.success) {
        successCount++;
      } else {
        failCount++;
        // Capture detailed error information
        if (res.error) {
          const errorDetail = res.document ? 
            `Document ${res.document}: ${res.error}` : 
            res.error;
          result.typesense.errors.push(errorDetail);
          failedDocuments.push(errorDetail);
        }
      }
    }
    
    result.typesense.indexed = successCount;
    result.typesense.failed = failCount;
    
    if (failCount > 0) {
      console.warn(`   ⚠️  Typesense: ${successCount} indexed, ${failCount} failed`);
      // Log first few failures for debugging
      failedDocuments.slice(0, 5).forEach(err => {
        console.warn(`      📋 Error: ${err}`);
      });
    } else {
      console.log(`   ✅ Typesense: ${successCount} documents indexed`);
    }
  } catch (err: any) {
    result.typesense.errors.push(err.message);
    result.typesense.failed = typesenseDocuments.length;
    result.success = false;
    console.error('❌ Typesense error:', err.message);
  }

  console.log('\n📊 Sync Result:', {
    total: rawListings.length,
    supabase: result.supabase,
    typesense: result.typesense
  });

  return result;
}

/**
 * Process large dataset in batches to avoid memory issues.
 * Useful for initial sync of thousands of records.
 */
export async function processInBatches(
  rawListings: any[],
  onProgress?: (progress: { processed: number; total: number }) => void
): Promise<SyncResult> {
  const total = rawListings.length;
  let processed = 0;
  
  const aggregateResult: SyncResult = {
    success: true,
    supabase: { inserted: 0, failed: 0, errors: [] },
    typesense: { indexed: 0, failed: 0, errors: [] }
  };

  // Process in batches
  for (let i = 0; i < rawListings.length; i += BATCH_SIZE) {
    const batch = rawListings.slice(i, i + BATCH_SIZE);
    const batchResult = await processBatch(batch);
    
    // Aggregate results
    aggregateResult.supabase.inserted += batchResult.supabase.inserted;
    aggregateResult.supabase.failed += batchResult.supabase.failed;
    aggregateResult.typesense.indexed += batchResult.typesense.indexed;
    aggregateResult.typesense.failed += batchResult.typesense.failed;
    
    // Collect errors (limit to first 10 per batch)
    const supabaseErrors = batchResult.supabase.errors.slice(0, 10);
    const typesenseErrors = batchResult.typesense.errors.slice(0, 10);
    aggregateResult.supabase.errors.push(...supabaseErrors);
    aggregateResult.typesense.errors.push(...typesenseErrors);
    
    if (!batchResult.success) {
      aggregateResult.success = false;
    }
    
    processed += batch.length;
    
    // Report progress
    if (onProgress) {
      onProgress({ processed, total });
    }
    
    console.log(`   Progress: ${processed}/${total} (${Math.round(processed / total * 100)}%)`);
  }

  return aggregateResult;
}

// ============================================================================
// Delta Sync Function
// ============================================================================

/**
 * Performs a delta sync - fetches only listings modified in the last N hours.
 * This is the primary sync mechanism for the ETL worker.
 * 
 * NOTE: This function is kept for backwards compatibility but delegates to the
 * ingester's runDeltaSync() for proper rate-limiting and state management.
 * Use: npx tsx scripts/worker/ingester.ts sync
 */
export async function deltaSync(hoursAgo: number = 24): Promise<SyncResult> {
  console.log(`\n🔄 Starting Legacy Delta Sync (last ${hoursAgo} hours)...`);
  console.log(`   ⚠️  Consider using: npx tsx scripts/worker/ingester.ts sync`);
  console.log(`   The legacy method lacks rate-limiting and state management.\n`);
  
  try {
    // Calculate cutoff timestamp
    const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    const cutoffIso = cutoffTime.toISOString();
    
    console.log(`   Cutoff: ${cutoffIso}`);
    
    // Fetch from Ampre RESO Web API using RESO_BEARER_TOKEN
    const BEARER_TOKEN = process.env.RESO_BEARER_TOKEN;
    if (!BEARER_TOKEN) {
      throw new Error('RESO_BEARER_TOKEN not configured');
    }
    
    // CRITICAL: Use $top=100 per request (rate limit compliance)
    const response = await fetch(
      `https://query.ampre.ca/odata/Property?$filter=ModificationTimestamp ge ${cutoffIso}&$top=100&$count=true`,
      {
        headers: {
          'Authorization': `Bearer ${BEARER_TOKEN}`,
          'Accept': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`RESO Web API error: ${response.status}`);
    }
    
    const data = await response.json();
    const listings = data.value || [];
    
    console.log(`   Found ${listings.length} listings modified since ${cutoffIso}`);
    
    if (listings.length === 0) {
      return {
        success: true,
        supabase: { inserted: 0, failed: 0, errors: [] },
        typesense: { indexed: 0, failed: 0, errors: [] }
      };
    }
    
    // Process listings (single batch - legacy mode)
    const result = await processInBatches(listings);
    
    console.log(`\n✅ Legacy delta sync complete!`);
    console.log(`   Supabase: ${result.supabase.inserted} inserted, ${result.supabase.failed} failed`);
    console.log(`   Typesense: ${result.typesense.indexed} indexed, ${result.typesense.failed} failed`);
    
    return result;
    
  } catch (err: any) {
    console.error('❌ Legacy delta sync failed:', err.message);
    return {
      success: false,
      supabase: { inserted: 0, failed: 0, errors: [err.message] },
      typesense: { indexed: 0, failed: 0, errors: [err.message] }
    };
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args[0] === 'delta') {
    const hours = parseInt(args[1] || '24', 10);
    await deltaSync(hours);
  } else if (args[0] === 'test') {
    // Test with mock data
    console.log('\n🧪 Running sync test with mock data...');
    const mockListings = [
      {
        ListingKey: 'MLS_TEST_001',
        ListPrice: 850000,
        City: 'Toronto',
        PostalCode: 'M5V 3A1',
        Latitude: null,
        Longitude: null,
        BedroomsTotal: 2,
        BathroomsTotalInteger: 2,
        PropertySubType: 'Condo',
        PropertyType: 'Residential',
        TransactionType: 'For Sale',
        OriginalEntryTimestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        PublicRemarks: 'Modern condo in prime location. Move-in ready.',
        Basement: ['None'],
        KitchensTotal: 1,
        TaxAnnualAmount: 3200,
        ListOfficeName: 'Test Realty'
      },
      {
        ListingKey: 'MLS_TEST_002',
        ListPrice: 1500000,
        City: 'Brampton',
        PostalCode: 'L6P 2Z1',
        Latitude: null,
        Longitude: null,
        BedroomsTotal: 4,
        BathroomsTotalInteger: 3,
        PropertySubType: 'Detached',
        PropertyType: 'Residential',
        TransactionType: 'For Sale',
        OriginalEntryTimestamp: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
        PublicRemarks: 'Estate sale. TLC needed. Handyman special. Contact contractor for details.',
        Basement: ['Unfinished'],
        KitchensTotal: 1,
        TaxAnnualAmount: 5800,
        ListOfficeName: 'Estate Agents Inc'
      }
    ];
    
    const result = await processBatch(mockListings);
    console.log('\n✅ Test complete! Result:', JSON.stringify(result, null, 2));
  } else {
    console.log(`
Shadow MLS Sync Worker
======================

Usage:
  npx tsx scripts/worker/sync.ts delta [hours]   - Delta sync (default: 24 hours)
  npx tsx scripts/worker/sync.ts test             - Test with mock data

Examples:
  npx tsx scripts/worker/sync.ts delta            # Sync last 24 hours
  npx tsx scripts/worker/sync.ts delta 48         # Sync last 48 hours
  npx tsx scripts/worker/sync.ts test              # Test sync with mock data
    `);
  }
}

main().catch(console.error);