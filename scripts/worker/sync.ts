/**
 * Shadow MLS - ETL Sync Orchestrator
 * 
 * Dual-write database orchestrator that routes transformed listings
 * to both Supabase (storage) and Typesense (search).
 * 
 * Phase 4 Integration: Temporal Distress Engine for True DOM calculation
 * - Batch generates property_hash for all listings
 * - Single Supabase query for historical matches (1 query, group locally)
 * - Computes true_dom and total_price_drop for investor filtering
 * 
 * Run: npx tsx scripts/worker/sync.ts
 */

// Load .env file
import 'dotenv/config';

import { getServiceRoleClient } from '@/lib/supabase/client';
import { transformListing, TransformResult } from './transformer';
import Typesense, { Client } from 'typesense';
import {
  generatePropertyHash,
  calculateTrueDOM,
  processTemporalBatch,
  groupHistoricalByHash,
  STITCH_WINDOW_DAYS,
  TemporalMetrics,
  HistoricalListing,
  CurrentListingInput
} from '@/lib/typesense/TemporalDistressEngine';

// ============================================================================
// Configuration
// ============================================================================

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
// Validated lazily in getAdminClient() — importing this module (via ingester.ts, or
// via /api/sync during `next build`) must not throw or require the key at load time.
const TYPESENSE_ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY;

// Batch size for database operations
const BATCH_SIZE = 100;

// ============================================================================
// Typesense Client (Admin - for writes)
// ============================================================================

let adminClient: Client | null = null;

function getAdminClient(): Client {
  if (!TYPESENSE_ADMIN_KEY) {
    throw new Error('TYPESENSE_ADMIN_API_KEY is not set in environment');
  }
  if (!adminClient) {
    adminClient = new Typesense.Client({
      nodes: [
        {
          host: TYPESENSE_HOST,
          port: TYPESENSE_PORT,
          protocol: 'https'
        }
      ],
      apiKey: TYPESENSE_ADMIN_KEY!,
      connectionTimeoutSeconds: 10
    });
  }
  return adminClient;
}

// ============================================================================
// Historical Listing Fetching (Phase 4 - Entity Resolution)
// ============================================================================

/**
 * Helper: Split array into chunks of specified size.
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Helper: Sleep utility for rate limiting.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================

/**
 * Re-wraps a flat aliased `listings` row (from the projected JSONB select) back
 * into the HistoricalListing shape the Temporal Distress Engine expects.
 */
function rowToHistoricalListing(row: any): HistoricalListing {
  return {
    listing_key: row.listing_key,
    property_hash: row.property_hash,
    created_at: row.created_at ?? '',
    full_payload: {
      OriginalEntryTimestamp: row.OriginalEntryTimestamp ?? undefined,
      ListPrice: row.ListPrice ?? undefined,
      CancellationDate: row.CancellationDate ?? undefined,
      ModificationTimestamp: row.ModificationTimestamp ?? undefined,
      SystemModificationTimestamp: row.SystemModificationTimestamp ?? undefined,
    },
  };
}

/**
 * Fetches prior SOLD campaigns for a batch of property hashes from the precomputed
 * property_sale_history table and maps each sale event into a HistoricalListing so the
 * engine can stitch ACROSS feeds. A property that previously sold and is now relisted
 * folds its prior campaign into the chain — true_dom and the chain's original list
 * price reflect the full history. The 35-day stitch window keeps genuine resales
 * (months/years apart) from being merged.
 *
 * We read the precompute (small, PK-indexed, refreshed nightly) rather than scanning
 * raw_vow_sold directly because raw_vow_sold.property_hash is an un-hashed address
 * string for ~all of the historical archive and never matches a listing's SHA-256.
 * property_sale_history is re-keyed with the SAME generatePropertyHash() listings use
 * (see scripts/admin/refresh-property-sale-history.ts), so these lookups join correctly.
 *
 * Returns Map<property_hash, HistoricalListing[]>.
 */
async function fetchSoldCampaigns(
  supabaseClient: any,
  propertyHashes: string[]
): Promise<Map<string, HistoricalListing[]>> {
  if (propertyHashes.length === 0) return new Map();

  const CHUNK_SIZE = 50;
  const chunks = chunkArray(propertyHashes, CHUNK_SIZE);
  const grouped = new Map<string, HistoricalListing[]>();
  const MAX_RETRIES = 3;

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    let success = false;
    let attempt = 0;

    while (!success && attempt < MAX_RETRIES) {
      try {
        const { data, error } = await supabaseClient
          .from('property_sale_history')
          .select('property_hash, sale_events')
          .in('property_hash', chunk);

        if (error) throw error;

        for (const row of (data as any[]) || []) {
          const hash = row.property_hash;
          if (!hash) continue;
          const events = Array.isArray(row.sale_events) ? row.sale_events : [];
          for (const e of events) {
            // Start = contract date (the "sold date") so the campaign has a start
            // anchor. End = close_date || contract_date, mapped to CancellationDate so
            // getListingEndDate() resolves it. ListPrice = list_price so a prior
            // campaign can become the chain's original price.
            const start = e.contract_date || e.close_date || null;
            const end = e.close_date || e.contract_date || null;
            const mapped: HistoricalListing = {
              listing_key: e.listing_key || `${hash}-sold`,
              property_hash: hash,
              created_at: end ?? '',
              full_payload: {
                OriginalEntryTimestamp: start ?? undefined,
                ListPrice: e.list_price ?? undefined,
                CancellationDate: end ?? undefined,
              },
            };
            const existing = grouped.get(hash);
            if (existing) existing.push(mapped);
            else grouped.set(hash, [mapped]);
          }
        }

        success = true;
      } catch (err: any) {
        attempt++;
        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 500;
          console.warn(`   ⏳ Retry ${attempt}/${MAX_RETRIES} for sold-campaign chunk ${chunkIdx + 1} in ${delay}ms...`);
          await sleep(delay);
        } else {
          console.error(`   ❌ Sold-campaign chunk ${chunkIdx + 1} failed after ${MAX_RETRIES} attempts: ${err.message}`);
        }
      }
    }

    if (chunkIdx < chunks.length - 1) {
      await sleep(50);
    }
  }

  const total = [...grouped.values()].reduce((n, arr) => n + arr.length, 0);
  if (total > 0) {
    console.log(`   🏷️  Found ${total} prior sold campaign(s) across ${grouped.size} properties`);
  }
  return grouped;
}

/**
 * Fetches historical listings for a batch of property hashes.
 * Implements the efficient batch pattern: 1 query, group locally.
 * 
 * OPTIMIZATION: Chunks 100 hashes into 4x25 batches, processed sequentially.
 * Uses explicit column selects to minimize payload size.
 * Implements retry with exponential backoff.
 * 
 * @param supabaseClient - Service role client for Supabase
 * @param propertyHashes - Array of property hashes to fetch
 * @param excludeListingKeys - Listing keys to exclude (current listings)
 * @returns Historical listings grouped by property_hash
 */
async function fetchHistoricalListings(
  supabaseClient: any,
  propertyHashes: string[],
  excludeListingKeys: string[]
): Promise<Map<string, HistoricalListing[]>> {
  if (propertyHashes.length === 0) {
    return new Map();
  }

  console.log(`   📚 Fetching historical listings for ${propertyHashes.length} properties...`);

  // Chunk into 25-hash sub-batches for sequential processing
  const CHUNK_SIZE = 25;
  const chunks = chunkArray(propertyHashes, CHUNK_SIZE);
  console.log(`   📦 Split into ${chunks.length} chunks of ${CHUNK_SIZE} hashes each`);

  // Build exclusion clause once (same for all chunks)
  const excludeClause = `(${excludeListingKeys.map(k => `'${k}'`).join(',')})`;

  // Process chunks sequentially with retry
  const MAX_RETRIES = 3;
  const allHistoricalData: any[] = [];

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    let success = false;
    let attempt = 0;

    while (!success && attempt < MAX_RETRIES) {
      try {
        // Project ONLY the JSONB keys calculateTrueDOM reads, then re-wrap into a
        // synthetic full_payload below. Selecting just `id, property_hash` (the old
        // behavior) starved the engine — every historical record was skipped and
        // true_dom collapsed to the current campaign with total_price_drop = 0.
        // `listing_key` is required so the current-listing self-exclusion works.
        // Light projection avoids detoasting the whole JSONB blob (Disk IO budget).
        const { data, error } = await supabaseClient
          .from('listings')
          .select(
            'listing_key, property_hash, created_at, ' +
              'OriginalEntryTimestamp:full_payload->OriginalEntryTimestamp, ' +
              'ListPrice:full_payload->ListPrice, ' +
              'CancellationDate:full_payload->CancellationDate, ' +
              'ModificationTimestamp:full_payload->ModificationTimestamp, ' +
              'SystemModificationTimestamp:full_payload->SystemModificationTimestamp'
          )
          .in('property_hash', chunk)
          .not('listing_key', 'in', excludeClause);

        if (error) {
          console.warn(`   ⚠️  Chunk ${chunkIdx + 1} attempt ${attempt + 1} warning: ${error.message}`);
          throw error;
        }

        if (data && data.length > 0) {
          // Re-wrap the flat aliased rows back into HistoricalListing shape so the
          // engine sees full_payload.{OriginalEntryTimestamp,ListPrice,...}.
          for (const row of data as any[]) {
            allHistoricalData.push(rowToHistoricalListing(row));
          }
        }

        success = true;
        console.log(`   ✅ Chunk ${chunkIdx + 1}/${chunks.length}: ${data?.length || 0} historical records`);

      } catch (err: any) {
        attempt++;
        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 500; // Exponential backoff: 500, 1000, 2000ms
          console.warn(`   ⏳ Retry ${attempt}/${MAX_RETRIES} for chunk ${chunkIdx + 1} in ${delay}ms...`);
          await sleep(delay);
        } else {
          console.error(`   ❌ Chunk ${chunkIdx + 1} failed after ${MAX_RETRIES} attempts: ${err.message}`);
        }
      }
    }

    // 50ms inter-chunk delay to regulate Supabase connection pool
    if (chunkIdx < chunks.length - 1) {
      await sleep(50);
    }
  }

  if (allHistoricalData.length === 0) {
    console.log(`   ℹ️  No historical listings found`);
    return new Map();
  }

  console.log(`   📊 Found ${allHistoricalData.length} historical listing records total`);
  
  // Group locally in memory
  const grouped = groupHistoricalByHash(allHistoricalData);
  
  return grouped;
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
 * 2. Generate property_hash for all listings (Phase 4)
 * 3. Fetch historical listings in single batch query (Phase 4)
 * 4. Calculate True DOM and price drop for each listing (Phase 4)
 * 5. Separate results into supabaseBatch and typesenseBatch
 * 6. Write to Supabase (storage)
 * 7. Write to Typesense (search index)
 * 
 * @param rawListings - Array of raw listing objects from MLS API
 * @param options - Optional processing flags
 * @param options.isSold - If true, marks listings as sold (is_sold: true in Typesense)
 */
export async function processBatch(rawListings: any[], options?: { isSold?: boolean }): Promise<SyncResult> {
  console.log(`\n📦 Processing batch of ${rawListings.length} listings...`);
  
  const result: SyncResult = {
    success: true,
    supabase: { inserted: 0, failed: 0, errors: [] },
    typesense: { indexed: 0, failed: 0, errors: [] }
  };

  // Step 1: Transform all listings (async due to Supabase AVM lookups)
  const transformed = await Promise.all(rawListings.map(raw => transformListing(raw)));
  
  // ─── Phase 4: Temporal Distress Engine ───────────────────────────────────
  // Generate property hashes and fetch historical data in batch
  const propertyHashes: string[] = [];
  const listingKeyToTransform = new Map<string, TransformResult>();
  
  for (const t of transformed) {
    const raw = t.supabasePayload.full_payload as any;
    const hash = generatePropertyHash(raw);
    propertyHashes.push(hash);
    listingKeyToTransform.set(t.supabasePayload.listing_key, t);
  }
  
  // Fetch historical listings (single query for all hashes) + prior sold campaigns
  // from the VOW archive, so True DOM stitches across BOTH feeds.
  const supabaseClient = getServiceRoleClient();
  const listingKeys = transformed.map(t => t.supabasePayload.listing_key);
  const uniqueHashes = [...new Set(propertyHashes)];
  const historicalMap = await fetchHistoricalListings(
    supabaseClient,
    uniqueHashes,
    listingKeys
  );
  const soldCampaignMap = await fetchSoldCampaigns(supabaseClient, uniqueHashes);
  
  // Calculate temporal metrics for each listing
  const temporalMetrics = new Map<string, TemporalMetrics>();
  
  for (const t of transformed) {
    const listingKey = t.supabasePayload.listing_key;
    const raw = t.supabasePayload.full_payload as any;
    const hash = generatePropertyHash(raw);
    
    // Get historical for this property — prior Active campaigns (listings table)
    // PLUS prior sold campaigns (raw_vow_sold), merged into one chain.
    const history = [
      ...(historicalMap.get(hash) || []),
      ...(soldCampaignMap.get(hash) || []),
    ];

    // Prepare current listing input
    const currentInput: CurrentListingInput = {
      listingKey: listingKey,
      propertyHash: hash,
      listPrice: raw.ListPrice || 0,
      originalEntryTimestamp: raw.OriginalEntryTimestamp || null
    };

    // Calculate True DOM (35-day stitch window defeats cancel-and-relist resets)
    const metrics = calculateTrueDOM(currentInput, history, {
      coolingOffDays: STITCH_WINDOW_DAYS,
    });
    temporalMetrics.set(listingKey, metrics);
    
    // Add temporal data to full payload for Supabase storage
    (t.supabasePayload.full_payload as any).property_hash = metrics.property_hash;
    (t.supabasePayload.full_payload as any).true_dom = metrics.true_dom;
    (t.supabasePayload.full_payload as any).total_price_drop = metrics.total_price_drop;
  }
  
  console.log(`   ⏱️  Temporal metrics calculated for ${temporalMetrics.size} listings`);
  
  // Log stale inventory detection
  const staleCount = [...temporalMetrics.values()].filter(m => m.is_stale).length;
  if (staleCount > 0) {
    console.log(`   🚨 Stale inventory detected: ${staleCount} listings`);
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Step 5: Separate into batches
  // FIX: Build records explicitly to avoid the property_hash integer bug.
  // Previously used spread {...t.supabasePayload} which accidentally included
  // the nested true_dom object when property_hash was later reassigned.
  // This caused Supabase to crash with: "invalid input syntax for type integer"
  // because the true_dom JSON string was being passed to the INTEGER column.
  const supabaseRecords = transformed.map(t => {
    const metrics = temporalMetrics.get(t.supabasePayload.listing_key);
    const p = t.supabasePayload;
    return {
      listing_key: p.listing_key,
      full_payload: p.full_payload,
      media_urls: p.media_urls,
      derived_metrics: p.derived_metrics,
      carry_cost: p.carry_cost,
      needs_geocoding: p.needs_geocoding,
      city: p.city,
      city_region: p.city_region,
      property_sub_type: p.property_sub_type,
      list_price: p.list_price,
      extrapolated_cap_rate: p.extrapolated_cap_rate,
      cap_rate_est: p.cap_rate_est,
      property_hash: metrics?.property_hash || '',
      // Flat carry cost columns (migration 005)
      monthly_carry_cost: p.monthly_carry_cost,
      monthly_mortgage: p.monthly_mortgage,
      monthly_property_tax: p.monthly_property_tax,
      monthly_hoa: p.monthly_hoa,
      monthly_insurance: p.monthly_insurance,
      monthly_capex: p.monthly_capex,
      // Flat suite analysis columns (migration 005)
      suite_status: p.suite_status,
      suite_score: p.suite_score,
      suite_flags: p.suite_flags,
      // Flat true DOM columns (migration 005)
      is_stale: p.is_stale,
      campaign_block_id: p.campaign_block_id,
      dead_days: p.dead_days,
    };
  });
  
  // Build typesense documents with temporal metrics
  const typesenseDocuments = transformed.map(t => {
    const tsDoc = t.typesensePayload as any;
    const metrics = temporalMetrics.get(t.supabasePayload.listing_key);
    
    const doc: any = {
      ...tsDoc,
      PropertyHash: metrics?.property_hash || '',
      TrueDom: metrics?.true_dom || 0,
      TotalPriceDrop: metrics?.total_price_drop || 0
    };
    
    // If processing sold listings, mark them with is_sold flag
    // so frontend can filter them out of active searches
    if (options?.isSold) {
      doc.IsSold = true;
    }
    
    return doc;
  });

  // Step 6: Write to Supabase (storage)
  console.log('💾 Writing to Supabase...');
  
  // Retry loop for Supabase upsert (network/resiliency)
  const MAX_RETRIES = 3;
  let upsertSuccess = false;
  let upsertAttempt = 0;

  while (!upsertSuccess && upsertAttempt < MAX_RETRIES) {
    try {
      // Batch upsert to Supabase (with property_hash)
      const { data, error } = await supabaseClient
        .from('listings')
        .upsert(supabaseRecords, { onConflict: 'listing_key' })
        .select('id');
      
      if (error) {
        result.supabase.errors.push(error.message);
        result.supabase.failed = rawListings.length;
        result.success = false;
        console.error(`❌ Supabase upsert attempt ${upsertAttempt + 1} failed:`, error.message);
        throw error;
      }
      
      result.supabase.inserted = data?.length || supabaseRecords.length;
      console.log(`   ✅ Supabase: ${result.supabase.inserted} records upserted`);
      upsertSuccess = true;

    } catch (err: any) {
      upsertAttempt++;
      if (upsertAttempt < MAX_RETRIES) {
        const delay = Math.pow(2, upsertAttempt) * 500;
        console.warn(`   ⏳ Retry ${upsertAttempt}/${MAX_RETRIES} for Supabase upsert in ${delay}ms...`);
        await sleep(delay);
      } else {
        result.supabase.errors.push(err.message);
        result.supabase.failed = rawListings.length;
        result.success = false;
        console.error('❌ Supabase upsert failed after 3 attempts:', err.message);
      }
    }
  }

  // Step 7: Write to Typesense (search index) — ACTIVE / available inventory only.
  // Listings no longer available (Sold/Closed, Leased, and other terminal statuses)
  // are never indexed: nothing in the frontend searches them and they only consume
  // Typesense RAM (caused bulk-sync OOM). Sold/lease comps are served from Supabase;
  // the Supabase `listings` table still keeps every status for True DOM history.
  const NON_ACTIVE_STATUSES = new Set([
    'sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended',
  ]);
  const searchableDocs = options?.isSold
    ? [] // entire sold batch (Query B) — never indexed
    : typesenseDocuments.filter(
        (d) => !NON_ACTIVE_STATUSES.has(String(d.Status ?? '').trim().toLowerCase()),
      );
  const skippedCount = typesenseDocuments.length - searchableDocs.length;

  if (searchableDocs.length === 0) {
    console.log(`🔍 Skipping Typesense — no active docs in batch (${skippedCount} non-active skipped)`);
  } else {
  if (skippedCount > 0) console.log(`🔍 Writing to Typesense (${searchableDocs.length} active, ${skippedCount} non-active skipped)...`);
  else console.log('🔍 Writing to Typesense...');
  try {
    const client = getAdminClient();

    // Use import endpoint with upsert action
    const importResponse = await client
      .collections('properties') // Updated to use 'properties' collection
      .documents()
      .import(searchableDocs, { action: 'upsert' });
    
    // Typesense import returns array of results
    const importResults = Array.isArray(importResponse) 
      ? importResponse 
      : JSON.parse(importResponse as unknown as string);
    
    let successCount = 0;
    let failCount = 0;
    
    const failedDocuments: string[] = [];
    
    for (const res of importResults) {
      if (res.success !== undefined && res.success) {
        successCount++;
      } else {
        failCount++;
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
      failedDocuments.slice(0, 5).forEach(err => {
        console.warn(`      📋 Error: ${err}`);
      });
    } else {
      console.log(`   ✅ Typesense: ${successCount} documents indexed`);
    }
  } catch (err: any) {
    result.typesense.errors.push(err.message);
    result.typesense.failed = searchableDocs.length;
    result.success = false;
    console.error('❌ Typesense error:', err.message);
    
    // Enhanced error verbosity: parse importResults for field-level validation failures
    if (err.importResults && Array.isArray(err.importResults)) {
      console.error('\n📋 Typesense Import Validation Failures:');
      console.error('═'.repeat(60));
      for (const item of err.importResults) {
        if (item.success === false || item.error) {
          const docId = item.document?.ListingKey || item.document?.id || 'unknown';
          console.error(`   📄 Document [${docId}]: ${item.error}`);
        }
      }
      console.error('═'.repeat(60));
    }
    
    if (err.httpBody) {
      console.error('   HTTP Body:', err.httpBody);
    }
  }
  } // end else — non-active listings excluded from the Typesense index

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
 */
export async function deltaSync(hoursAgo: number = 24): Promise<SyncResult> {
  console.log(`\n🔄 Starting Legacy Delta Sync (last ${hoursAgo} hours)...`);
  console.log(`   ⚠️  Consider using: npx tsx scripts/worker/ingester.ts sync`);
  console.log(`   The legacy method lacks rate-limiting and state management.\n`);
  
  try {
    const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    const cutoffIso = cutoffTime.toISOString();
    
    console.log(`   Cutoff: ${cutoffIso}`);
    
    const BEARER_TOKEN = process.env.RESO_BEARER_TOKEN;
    if (!BEARER_TOKEN) {
      throw new Error('RESO_BEARER_TOKEN not configured');
    }
    
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
        CityRegion: 'Greater Toronto Area',
        PostalCode: 'M5V 3A1',
        Latitude: null,
        Longitude: null,
        BedroomsTotal: 2,
        BathroomsTotalInteger: 2,
        PropertySubType: 'Condo',
        PropertyType: 'Residential',
        TransactionType: 'For Sale',
        ParkingTotal: 1,
        ApproximateAge: '0-5 Years',
        Status: 'Active',
        MlsStatus: 'Active',
        LotWidth: 30.5,
        LotDepth: 60.2,
        OriginalEntryTimestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        PublicRemarks: 'Modern condo in prime location. Move-in ready.',
        Basement: ['None'],
        KitchensTotal: 1,
        TaxAnnualAmount: 3200,
        AssociationFee: 0,
        ListOfficeName: 'Test Realty',
        StreetNumber: '12',
        StreetName: 'King West',
        UnitNumber: '1605',
        media: [
          { MediaURL: 'https://example.com/photo1.jpg', MediaStatus: 'Available', Order: 0, ImageSizeDescription: 'Medium' },
          { MediaURL: 'https://example.com/photo2.jpg', MediaStatus: 'Available', Order: 1, ImageSizeDescription: 'Medium' }
        ]
      },
      {
        ListingKey: 'MLS_TEST_002',
        ListPrice: 1500000,
        City: 'Brampton',
        CityRegion: 'Greater Toronto Area',
        PostalCode: 'L6P 2Z1',
        Latitude: null,
        Longitude: null,
        BedroomsTotal: 4,
        BathroomsTotalInteger: 3,
        PropertySubType: 'Detached',
        PropertyType: 'Residential',
        TransactionType: 'For Sale',
        ParkingTotal: 2,
        ApproximateAge: '30-50 Years',
        Status: 'Active',
        MlsStatus: 'Active',
        LotWidth: 50.0,
        LotDepth: 120.5,
        OriginalEntryTimestamp: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
        PublicRemarks: 'Estate sale. TLC needed. Handyman special. Contact contractor for details.',
        Basement: ['Unfinished'],
        KitchensTotal: 1,
        TaxAnnualAmount: 5800,
        AssociationFee: 0,
        ListOfficeName: 'Estate Agents Inc',
        StreetNumber: '45',
        StreetName: 'Main Street North',
        UnitNumber: null,
        media: [
          { MediaURL: 'https://example.com/house1.jpg', MediaStatus: 'Available', Order: 0, ImageSizeDescription: 'Medium' },
          { MediaURL: 'https://example.com/house2.jpg', MediaStatus: 'Available', Order: 1, ImageSizeDescription: 'Large' }
        ]
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

Phase 4 Features:
  - True DOM calculation (Shadow DOM) via entity resolution
  - Batch property_hash generation for all listings
  - Historical lookup with 45-day cooling-off threshold
  - Stale inventory detection (>60 days True DOM)
  - Total price drop calculation from first listing in chain

Examples:
  npx tsx scripts/worker/sync.ts delta            # Sync last 24 hours
  npx tsx scripts/worker/sync.ts delta 48         # Sync last 48 hours
  npx tsx scripts/worker/sync.ts test              # Test sync with mock data
    `);
  }
}

// Only run the CLI when executed directly (e.g. `tsx scripts/worker/sync.ts delta`).
// ingester.ts and the /api/sync route import this module for processBatch/getAdminClient
// — importing it must NOT trigger CLI execution (and `next build` must not run it).
const isMainModule =
  typeof process !== 'undefined' && process.argv[1]?.includes('sync.ts');
if (isMainModule) {
  main().catch(console.error);
}