/**
 * Shadow MLS - Thumbnail Backfill Script
 * 
 * Re-extracts primaryImageUrl from raw VOW payload images/media arrays
 * and updates Typesense documents with the optimized thumbnail URL.
 * 
 * The ETL transformer was updated to extract thumbnails, but existing
 * listings in Typesense don't have this field populated.
 * 
 * Run: npx tsx scripts/worker/backfill-thumbnails.ts
 */

// MUST set TLS env var BEFORE importing supabase client
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Typesense from 'typesense';
import * as https from 'https';

import crossFetch from 'cross-fetch';

const agent = new https.Agent({ rejectUnauthorized: false });
const patchedFetch: typeof fetch = (url, init) => {
  return crossFetch(url, {
    ...init,
    // @ts-ignore
    agent
  });
};
(global as unknown as { fetch: typeof fetch }).fetch = patchedFetch;

// ============================================================================
// Configuration
// ============================================================================

const CHUNK_SIZE = 500;
const TYPESENSE_COLLECTION = 'listings';
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pyzgnivixhnwzfrdkiq.supabase.co').trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TYPESENSE_ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY || 'B6u0qIHDNhXZH8PMw0E6J5tB5aWvLXCn';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

// ============================================================================
// Thumbnail Extraction (same logic as transformer.ts)
// ============================================================================

interface MediaItem {
  MediaURL?: string;
  MediaStatus?: string;
  Order?: number;
  ImageSizeDescription?: string;
}

function extractPrimaryImageUrl(raw: Record<string, unknown>): string | null {
  let primaryThumbnailUrl: string | null = null;
  const mediaUrls: string[] = [];

  // Process media array
  if (raw.media && Array.isArray(raw.media)) {
    (raw.media as MediaItem[]).forEach((m) => {
      if (m.MediaURL && m.MediaStatus !== 'Deleted') {
        mediaUrls.push(m.MediaURL);
        
        if (!primaryThumbnailUrl && m.MediaURL) {
          if (m.Order === 0 || m.Order === 1) {
            if (m.ImageSizeDescription === 'Medium' || m.ImageSizeDescription === 'Thumbnail' || m.ImageSizeDescription === 'Large') {
              primaryThumbnailUrl = m.MediaURL;
            }
          }
        }
      }
    });
  }

  // Process images array (alternative format)
  if (raw.images && Array.isArray(raw.images)) {
    (raw.images as MediaItem[]).forEach((m) => {
      if (m.MediaURL && !mediaUrls.includes(m.MediaURL)) {
        mediaUrls.push(m.MediaURL);
        
        if (!primaryThumbnailUrl && m.MediaURL) {
          if (m.Order === 0 || m.Order === 1) {
            if (m.ImageSizeDescription === 'Medium' || m.ImageSizeDescription === 'Thumbnail' || m.ImageSizeDescription === 'Large') {
              primaryThumbnailUrl = m.MediaURL;
            }
          }
        }
      }
    });
    
    // Fallback: first "Medium" image
    if (!primaryThumbnailUrl) {
      const mediumImage = (raw.images as MediaItem[]).find((m) => 
        m.MediaURL && m.ImageSizeDescription === 'Medium'
      );
      if (mediumImage?.MediaURL) {
        primaryThumbnailUrl = mediumImage.MediaURL;
      }
    }

    // Final fallback: first available image
    if (!primaryThumbnailUrl && mediaUrls.length > 0) {
      primaryThumbnailUrl = mediaUrls[0];
    }
  }

  return primaryThumbnailUrl;
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
// Process batch
// ============================================================================

interface ChunkResult {
  processed: number;
  updated: number;
  skipped: number;
  errors: string[];
}

async function processChunk(records: { listing_key: string; full_payload: Record<string, unknown> }[]): Promise<ChunkResult> {
  const result: ChunkResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: []
  };

  const documents: { id: string; primaryImageUrl: string }[] = [];

  for (const record of records) {
    result.processed++;
    
    const primaryImageUrl = extractPrimaryImageUrl(record.full_payload);
    
    if (primaryImageUrl) {
      documents.push({
        id: record.listing_key,
        primaryImageUrl
      });
      result.updated++;
    } else {
      result.skipped++;
    }
  }

  // Upsert to Typesense
  if (documents.length > 0) {
    try {
      const importResult = await typesense
        .collections(TYPESENSE_COLLECTION)
        .documents()
        .import(documents, { action: 'upsert' });
      
      if (Array.isArray(importResult)) {
        const failed = importResult.filter((r: any) => !r.success);
        if (failed.length > 0) {
          result.errors.push(`${failed.length} failed to upsert`);
        }
      }
    } catch (err) {
      result.errors.push(`Typesense error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// ============================================================================
// Fetch listings from Supabase
// ============================================================================

async function fetchChunk(lastId: number | null): Promise<{ records: any[]; lastId: number | null; hasMore: boolean }> {
  let query = supabase
    .from('listings')
    .select('id, listing_key, full_payload')
    .order('id', { ascending: true })
    .limit(CHUNK_SIZE);
  
  if (lastId !== null) {
    query = query.gt('id', lastId);
  }
  
  const { data, error } = await query;
  
  if (error) {
    throw new Error(`Fetch failed: ${error.message}`);
  }
  
  const records = data || [];
  const lastRecordId = records.length > 0 ? records[records.length - 1].id : null;
  
  return {
    records,
    lastId: lastRecordId,
    hasMore: records.length === CHUNK_SIZE
  };
}

// ============================================================================
// Main
// ============================================================================

async function backfill() {
  console.log('\n🔄 Shadow MLS - Thumbnail Backfill');
  console.log('=====================================\n');
  
  // Count total
  const { count } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true });
  
  const totalRecords = count ?? 0;
  console.log(`Total listings to process: ${totalRecords.toLocaleString()}\n`);
  
  if (totalRecords === 0) {
    console.log('✅ No listings to process.');
    return;
  }
  
  let lastId: number | null = null;
  let processedCount = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let batchNumber = 0;
  let hasMore = true;
  
  while (hasMore) {
    batchNumber++;
    
    const { records, lastId: newLastId } = await fetchChunk(lastId);
    lastId = newLastId;
    hasMore = records.length === CHUNK_SIZE;
    
    if (records.length === 0) break;
    
    const result = await processChunk(records);
    
    processedCount += result.processed;
    totalUpdated += result.updated;
    totalSkipped += result.skipped;
    
    const progress = ((processedCount / totalRecords) * 100).toFixed(1);
    console.log(
      `[Batch ${batchNumber}] ${processedCount.toLocaleString()} / ${totalRecords.toLocaleString()} (${progress}%)` +
      ` | Updated: ${result.updated} | Skipped: ${result.skipped}` +
      (result.errors.length > 0 ? ` | Errors: ${result.errors.join(', ')}` : '')
    );
    
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log('\n=====================================');
  console.log('✅ Backfill Complete!');
  console.log('=====================================');
  console.log(`   Records processed: ${processedCount.toLocaleString()}`);
  console.log(`   Thumbnails updated: ${totalUpdated.toLocaleString()}`);
  console.log(`   Skipped (no images): ${totalSkipped.toLocaleString()}`);
  console.log('');
}

backfill()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  });