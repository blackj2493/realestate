/**
 * Shadow MLS - ETL Sync Orchestrator
 * 
 * Dual-write database orchestrator that routes transformed listings
 * to both Supabase (storage) and Typesense (search).
 *
 * True DOM: per active listing, refreshes the campaign-history ledger
 * (best-effort, 24h-TTL cached, subject-merged, never-regress) via the VOW feed
 * and writes the corrected true_dom/total_price_drop to full_payload + Typesense.
 * Sold batches skip the ledger refresh (no VOW fetch — they aren't indexed).
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
  STALE_THRESHOLD_DAYS,
} from '@/lib/typesense/TemporalDistressEngine';
import { refreshCampaignHistoryForListing } from '@/lib/campaignHistory/store';
import { normalizeCampaign, type RawVowCampaign } from '@/lib/campaignHistory/normalize';
import {
  NON_ACTIVE_STATUSES,
  collectStaleSearchDocIds,
  buildIdDeleteFilters,
} from './staleSearchDocs';

// ============================================================================
// Configuration
// ============================================================================

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
// Validated lazily in getAdminClient() — importing this module (via ingester.ts)
// must not throw or require the key at load time.
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

/**
 * Helper: Sleep utility for rate limiting.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
 * 2. Generate property_hash for every listing
 * 3. Per ACTIVE listing, refresh the campaign-history ledger (VOW feed,
 *    best-effort/24h-TTL/never-regress) for the corrected true_dom/total_price_drop;
 *    SOLD batches skip the refresh (no VOW fetch — they aren't indexed)
 * 4. Separate results into supabaseBatch and typesenseBatch
 * 5. Write to Supabase (storage)
 * 6. Write to Typesense (search index)
 *
 * @param rawListings - Array of raw listing objects from MLS API
 * @param options - Optional processing flags
 * @param options.isSold - If true, marks listings as sold (is_sold: true in Typesense)
 *   and SKIPS the per-listing ledger refresh (sold True DOM is never surfaced)
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
  
  // ─── Campaign-History Ledger (replaces broken stitch) ───────────────────
  // Per ACTIVE listing: refresh the campaign-history ledger (best-effort, 24h-TTL
  // cached, subject-always-merged, never-regress) and write the corrected
  // true_dom/total_price_drop to full_payload + Typesense TrueDom. Sold batches
  // skip the VOW fetch (see the in-loop guard). Replaces the old
  // fetchHistoricalListings/fetchSoldCampaigns/calculateTrueDOM stitch.
  const supabaseClient = getServiceRoleClient();
  const vowToken = process.env.PROPTX_VOW_TOKEN;
  const nowMs = Date.now();
  const temporalMetrics = new Map<string, { true_dom: number; total_price_drop: number; property_hash: string; is_stale: boolean }>();

  for (const t of transformed) {
    const listingKey = t.supabasePayload.listing_key;
    const raw = t.supabasePayload.full_payload as Record<string, unknown>;
    const propertyHash = generatePropertyHash(raw);
    let true_dom = 0;
    let total_price_drop = 0;
    let is_stale = false;
    // Sold/Closed batches (Query B → isSold) are never indexed in Typesense and their
    // True DOM is not surfaced, so skip the per-listing VOW address-query entirely —
    // firing one fetch per sold record (then discarding it) would be a needless feed
    // hit and a TRREB API-revocation risk (CLAUDE.md §4). Active listings still refresh.
    if (!options?.isSold) {
      try {
        const row = await refreshCampaignHistoryForListing(supabaseClient, {
          propertyHash,
          addr: {
            StreetNumber: raw['StreetNumber'],
            StreetName: raw['StreetName'],
            City: raw['City'],
            UnitNumber: raw['UnitNumber'],
            PropertySubType: raw['PropertySubType'],
          },
          subjectEvent: normalizeCampaign(raw as RawVowCampaign),
          vowToken,
          nowMs,
        });
        if (row) {
          true_dom = row.true_dom;
          total_price_drop = row.total_price_drop;
          is_stale = row.is_stale;
        }
      } catch (e) {
        console.warn(`[sync] campaign-history refresh failed for ${listingKey}:`, (e as Error)?.message ?? e);
      }
      // Naive-age floor: a property's cumulative True DOM is AT LEAST its current
      // listing's age (days since OriginalEntryTimestamp). Without this, listings the
      // best-effort campaign refresh missed default true_dom=0 and understate both the
      // True-DoM median and % stale (a 90-day listing wrongly reads is_stale=false).
      const oetMs = Date.parse(String(raw['OriginalEntryTimestamp'] ?? ''));
      if (Number.isFinite(oetMs)) {
        const naiveAge = Math.max(0, Math.floor((nowMs - oetMs) / 86_400_000));
        if (naiveAge > true_dom) {
          true_dom = naiveAge;
          is_stale = true_dom > STALE_THRESHOLD_DAYS;
        }
      }
    }
    raw['property_hash'] = propertyHash;
    raw['true_dom'] = true_dom;
    raw['total_price_drop'] = total_price_drop;
    temporalMetrics.set(listingKey, { true_dom, total_price_drop, property_hash: propertyHash, is_stale });
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
      // Flat dimension columns (migration 045) — region RPC floors without detoast
      bedrooms_total: p.bedrooms_total,
      bathrooms_total_integer: p.bathrooms_total_integer,
      parking_total: p.parking_total,
      lot_width: p.lot_width,
      basement_tier: p.basement_tier,
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
      // Flat true DOM columns (migration 005). true_dom + is_stale MUST come from the
      // campaign-stitched metrics (same source as Typesense TrueDom below), NOT the
      // transformer's pre-stitch basicDOM placeholder — the region RPCs read these flat
      // columns (placeholder undercounted stale ~12x, 2% vs ~24%). true_dom is the
      // integer metric (not the transformer's TrueDOMResult object, which crashed the
      // INTEGER column — see the explicit-record comment above).
      true_dom: metrics?.true_dom ?? 0,
      is_stale: metrics?.is_stale ?? p.is_stale,
      campaign_block_id: p.campaign_block_id,
      dead_days: p.dead_days,
      // Flat status + entry timestamp (migration 067) so region_active_aggregates /
      // region_dom_distribution skip the per-row full_payload detoast that was timing
      // Toronto out (>60s). Same lowercased coalesced status the RPC status-filter uses;
      // the RPC COALESCEs to full_payload only when these are NULL (null-safe).
      original_entry_timestamp: (() => {
        const ms = Date.parse(String((p.full_payload as any)?.OriginalEntryTimestamp ?? ''));
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
      })(),
      standard_status: (() => {
        const fp = p.full_payload as any;
        const s = fp?.Status ?? fp?.MlsStatus ?? fp?.StandardStatus ?? '';
        return s ? String(s).toLowerCase() : null;
      })(),
      // Flat normalized address (migration 071) so region_listing_outcomes can exclude
      // currently-active (relisted) addresses without a full_payload detoast. '' when absent.
      norm_address: (() => {
        const a = (p.full_payload as any)?.UnparsedAddress;
        return a ? String(a).trim().toLowerCase() : '';
      })(),
      // Flat relist-stitched price drop (migration 074) so region_price_cuts skips the
      // full_payload detoast (Toronto was ~32s). Same source as the full_payload write above.
      total_price_drop: metrics?.total_price_drop ?? 0,
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
      TotalPriceDrop: metrics?.total_price_drop || 0,
      // IsStale MUST track the stitched+naive-floored TrueDom (60d) computed above, NOT the
      // transformer's naive basicDOM>90 placeholder in ...tsDoc — otherwise the STALE badge /
      // watchlist "going stale" / IsStale:=true bubbles contradict the TrueDom on the same doc.
      IsStale: metrics?.is_stale ?? false,
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

  // Step 8: Delete stale docs from the search index. A doc upserted while the
  // listing was Active otherwise freezes in `properties` forever ("New" at the
  // old list price) because Query A only fetches StandardStatus eq 'Active' and
  // sold batches skip the Typesense write. Entire sold (Query B) batch + any
  // terminal-status docs filtered out of an active batch are deleted here.
  const staleIds = collectStaleSearchDocIds(typesenseDocuments, options);
  if (staleIds.length > 0) {
    try {
      const client = getAdminClient();
      let deleted = 0;
      for (const filter of buildIdDeleteFilters(staleIds)) {
        const res: any = await client
          .collections('properties')
          .documents()
          .delete({ filter_by: filter } as any);
        deleted += res?.num_deleted ?? 0;
      }
      console.log(`   🧹 Typesense: ${deleted} stale doc(s) deleted (${staleIds.length} keys checked)`);
    } catch (err: any) {
      // Non-fatal: a missed delete only leaves a stale doc for the next sold
      // batch or backfill purge to retry — never fail the sync over cleanup.
      result.typesense.errors.push(`stale-doc delete failed: ${err.message}`);
      console.warn(`   ⚠️  Stale-doc delete failed (non-fatal): ${err?.message || err}`);
    }
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
// CLI Entry Point
// ============================================================================
// NOTE: The legacy `deltaSync` function (hard-required RESO_BEARER_TOKEN, a
// single-token path that caused a 6-day sync outage on 2026-05-14) was deleted
// 2026-06-12. The daily sync uses `scripts/worker/ingester.ts sync` exclusively.
// MEDIUM-4/LOW-4 remediation.

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'test') {
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
  npx tsx scripts/worker/sync.ts test   - Process mock listings through the
                                          processBatch pipeline (dev smoke-test)

For the daily delta sync use:
  npx tsx scripts/worker/ingester.ts sync
    `);
  }
}

// Only run the CLI when executed directly (e.g. `tsx scripts/worker/sync.ts delta`).
// ingester.ts imports this module for processBatch/getAdminClient
// — importing it must NOT trigger CLI execution (and `next build` must not run it).
const isMainModule =
  typeof process !== 'undefined' && process.argv[1]?.includes('sync.ts');
if (isMainModule) {
  main().catch(console.error);
}