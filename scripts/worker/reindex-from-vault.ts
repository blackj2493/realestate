/**
 * Shadow MLS - Vault Re-Indexer
 * 
 * Re-indexes ALL listings from Supabase Vault (listings table) into Typesense.
 * Uses the transformer.ts to process full_payload JSON records.
 * 
 * Run: npx tsx scripts/worker/reindex-from-vault.ts
 */

import { createClient } from '@supabase/supabase-js';
import Typesense from 'typesense';

// ============================================================================
// Configuration
// ============================================================================

const CHUNK_SIZE = 500;
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;

// Environment variables
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://pyzgnivixhnwzfrdkiq.supabase.co').trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TYPESENSE_ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY || 'B6u0qIHDNhXZH8PMw0E6J5tB5aWvLXCn';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

// ============================================================================
// Types (duplicated from transformer for standalone execution)
// ============================================================================

interface DerivedMetrics {
  calculatedDOM: number | null;
  targetGrossYield: number | null;
  isDistressed: boolean;
  hasSecondarySuitePotential: boolean;
}

// ============================================================================
// Import transformer functions
// ============================================================================

// Dynamic import to ensure postal codes are loaded
async function getTransformer() {
  const { transformListing, calculateDerivedMetrics } = await import('./transformer');
  return { transformListing, calculateDerivedMetrics };
}

// ============================================================================
// Supabase client
// ============================================================================

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ============================================================================
// Typesense client
// ============================================================================

const typesense = new Typesense.Client({
  nodes: [{
    host: TYPESENSE_HOST,
    port: TYPESENSE_PORT,
    protocol: 'https'
  }],
  apiKey: TYPESENSE_ADMIN_KEY,
  connectionTimeoutSeconds: 10
});

// ============================================================================
// Re-index Functions
// ============================================================================

interface ListingRecord {
  listing_key: string;
  full_payload: Record<string, unknown>;
  derived_metrics: DerivedMetrics;
  needs_geocoding: boolean;
  city: string | null;
  property_sub_type: string | null;
}

/**
 * Extract location from full_payload using transformer logic
 * This mirrors resolveLocation() from transformer.ts
 */
function extractLocation(raw: Record<string, unknown>): { location: [number, number]; needsGeocoding: boolean } {
  const FALLBACK_LNG = -79.3832;
  const FALLBACK_LAT = 43.6532;
  
  const postalCode = raw.PostalCode as string | null;
  const apiLat = raw.Latitude as number | null;
  const apiLng = raw.Longitude as number | null;
  
  // Import getCoordinates dynamically
  const postalCodes = require('../../src/lib/postalCodes');
  const coords = postalCodes.getCoordinates(postalCode);
  
  if (coords) {
    return {
      location: [coords.lng, coords.lat] as [number, number],
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
  
  // Fallback to Toronto
  return {
    location: [FALLBACK_LNG, FALLBACK_LAT] as [number, number],
    needsGeocoding: true
  };
}

/**
 * Transform a vault listing record into a Typesense document
 */
function transformVaultListing(record: ListingRecord) {
  const raw = record.full_payload;
  const geo = extractLocation(raw);
  const metrics = record.derived_metrics;
  
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
    document.BuildingAreaTotal = raw.BuildingAreaTotal;
  }
  if (metrics.targetGrossYield !== null) document.targetGrossYield = metrics.targetGrossYield;
  if (metrics.calculatedDOM !== null) document.calculatedDOM = metrics.calculatedDOM;
  if (raw.ListOfficeName) document.ListOfficeName = raw.ListOfficeName;
  
  return document;
}

/**
 * Process a single chunk of listings
 */
async function processChunk(chunk: ListingRecord[]): Promise<{ success: number; failed: number }> {
  const documents = chunk.map(transformVaultListing);
  
  try {
    // Bulk upsert to Typesense
    const result = await typesense.collections('listings').documents().import(documents, {
      action: 'upsert'
    });
    
    // Typesense import returns array of results
    const results = Array.isArray(result) ? result : [result];
    const failed = results.filter((r: { success?: boolean; error?: string }) => !r.success).length;
    
    return {
      success: results.length - failed,
      failed
    };
  } catch (error) {
    console.error('   ❌ Chunk import failed:', error);
    return { success: 0, failed: chunk.length };
  }
}

/**
 * Run the full re-index from Supabase vault
 */
async function reindexFromVault() {
  console.log('\n🚀 Shadow MLS - Vault Re-Indexer');
  console.log('================================\n');
  
  console.log('📋 Configuration:');
  console.log(`   Supabase URL: ${SUPABASE_URL.replace(SUPABASE_SERVICE_ROLE_KEY, '***').replace(SUPABASE_SERVICE_ROLE_KEY, '***')}`);
  console.log(`   Chunk size: ${CHUNK_SIZE}`);
  console.log(`   Typesense: ${TYPESENSE_HOST}:${TYPESENSE_PORT}\n`);
  
  // Count total records
  console.log('🔍 Counting listings in vault...');
  const { count, error: countError } = await supabase
    .from('listings')
    .select('*', { count: 'exact', head: true });
  
  if (countError) {
    console.error('❌ Failed to count listings:', countError.message);
    process.exit(1);
  }
  
  const totalRecords = count ?? 0;
  const totalChunks = Math.ceil(totalRecords / CHUNK_SIZE);
  console.log(`   Total listings: ${totalRecords.toLocaleString()}`);
  console.log(`   Total chunks: ${totalChunks}\n`);
  
  if (totalRecords === 0) {
    console.log('✅ No listings to index. Exiting.');
    return;
  }
  
  // Process chunks
  console.log('📦 Starting re-index...\n');
  
  let processedRecords = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  
  for (let chunkNum = 1; chunkNum <= totalChunks; chunkNum++) {
    const offset = (chunkNum - 1) * CHUNK_SIZE;
    
    // Fetch chunk from Supabase
    const { data: records, error: fetchError } = await supabase
      .from('listings')
      .select('listing_key, full_payload, derived_metrics, needs_geocoding, city, property_sub_type')
      .range(offset, offset + CHUNK_SIZE - 1);
    
    if (fetchError) {
      console.error(`\n❌ Failed to fetch chunk ${chunkNum}/${totalChunks}:`, fetchError.message);
      continue;
    }
    
    if (!records || records.length === 0) {
      break;
    }
    
    // Process chunk
    const chunkRecords = records as unknown as ListingRecord[];
    const result = await processChunk(chunkRecords);
    
    processedRecords += chunkRecords.length;
    totalSuccess += result.success;
    totalFailed += result.failed;
    
    // Progress logging
    const progress = ((processedRecords / totalRecords) * 100).toFixed(1);
    console.log(
      `   Chunk ${chunkNum}/${totalChunks}... ` +
      `${processedRecords.toLocaleString()}/${totalRecords.toLocaleString()} (${progress}%) ` +
      `[+${result.success}${result.failed > 0 ? `, -${result.failed}` : ''}]`
    );
    
    // Rate limiting - small delay between chunks
    if (chunkNum < totalChunks) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Summary
  console.log('\n================================');
  console.log('📊 Re-Index Complete!');
  console.log('================================');
  console.log(`   Total records processed: ${processedRecords.toLocaleString()}`);
  console.log(`   Successfully indexed: ${totalSuccess.toLocaleString()}`);
  console.log(`   Failed: ${totalFailed.toLocaleString()}`);
  console.log('');
  
  if (totalFailed > 0) {
    console.warn('⚠️  Some records failed to index. Check logs above.');
  }
  
  // Verify final count
  try {
    const tsStats = await typesense.collections('listings').retrieve();
    console.log(`\n✅ Typesense collection now contains: ${(tsStats as any).num_documents.toLocaleString()} documents`);
  } catch (err) {
    console.log('\n⚠️  Could not verify Typesense count:', err);
  }
  
  console.log('\n');
}

// ============================================================================
// Main Execution
// ============================================================================

reindexFromVault().catch(error => {
  console.error('\n❌ Re-indexer crashed:', error);
  process.exit(1);
});