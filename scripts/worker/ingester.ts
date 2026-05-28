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
import {
  getSoldAdminClient,
  toSoldDocument,
  importSoldBatch,
  pruneOldSold,
} from './soldIndexer';
import type { SoldListingDocument } from '@/lib/typesense/soldListingsSchema';
import {
  deriveInteriorTier,
  deriveExteriorTier,
  deriveBasementTier,
  deriveHasFinishedBasement,
} from '@/lib/avm/conditionScoring';
import { generatePropertyHash } from '@/lib/typesense/TemporalDistressEngine';
import { fetchRoomsForKeys } from './roomsEnrichment';
import { enrichListingsWithMedia } from './mediaEnrichment';
import { nextSyncCursor } from './syncCursor';

// ============================================================================
// Sold Listing Types
// ============================================================================

// Mirrors the raw_vow_sold columns. Built field-by-field (CLAUDE.md §6 — never
// spread). nullable numeric/text columns use `| null`; the NOT NULL columns
// (listing_key, property_hash, close_price, property_sub_type, raw_payload, the
// three tiers, has_finished_basement) always get a concrete value.
interface SoldListingRecord {
  listing_key: string;
  // Computed with the SAME generatePropertyHash() the listings table uses so
  // AVM/temporal stitching can join the two on hash.
  property_hash: string;
  unparsed_address: string | null;
  city_region: string;
  city: string | null;
  postal_code: string | null;
  property_sub_type: string;
  architectural_style: string | null;
  approximate_age: string | null;
  living_area_range: number | null;
  building_area_total: number | null;
  lot_width: number | null;
  lot_depth: number | null;
  bedrooms_above_grade: number | null;
  bedrooms_below_grade: number | null;
  bathrooms_total_integer: number | null;
  rooms_above_grade: number | null;
  rooms_below_grade: number | null;
  kitchens_above_grade: number | null;
  kitchens_below_grade: number | null;
  parking_total: number | null;
  covered_spaces: number | null;
  tax_annual_amount: number | null;
  association_fee: number | null;
  list_price: number | null;
  close_price: number;
  purchase_contract_date: string | null;
  close_date: string | null;
  has_finished_basement: boolean;
  // Deterministic condition tiers (see src/lib/avm/conditionScoring.ts):
  // interior_tier (1-5) / exterior_tier (1-5) / basement_tier (1-9).
  interior_tier: number;
  exterior_tier: number;
  basement_tier: number;
  // Full raw VOW payload (NOT NULL JSONB). Powers re-scoring / future backfills.
  raw_payload: Record<string, unknown>;
}

// ── small coercion helpers (messy board data; CLAUDE.md §6 fallbacks) ──────────
function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function styleToString(v: unknown): string | null {
  if (Array.isArray(v)) return v.length ? v.filter(Boolean).join(', ') : null;
  return v ? String(v) : null;
}
// living_area_range is an INTEGER column though TRREB sends a bucket string
// ("1500-2000"). The historical convention stores the midpoint (→ 1750).
function livingAreaRangeToInt(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return Math.round((Number(m[1]) + Number(m[2])) / 2);
  const single = Number(s);
  return Number.isFinite(single) ? Math.round(single) : null;
}

/**
 * Checks if a listing status indicates it has been sold/closed.
 * Uses strict RESO status normalization per system instructions.
 * 
 * Maps Canadian board sub-statuses to canonical status:
 * - 'New', 'Active', 'Price Change', 'Extension' → { status: "ACTIVE", isSold: false }
 * - 'Closed', 'Sold', 'Closed Sale' → { status: "CLOSED", isSold: true }
 */
function isSoldListing(raw: any): boolean {
  const standardStatus = (raw.StandardStatus || '').toLowerCase().trim();
  const mlStatus = (raw.MlsStatus || '').toLowerCase().trim();
  
  // Active statuses (not sold)
  const ACTIVE_STATUSES = ['new', 'active', 'price change', 'extension'];
  
  // Closed/Sold statuses
  const CLOSED_STATUSES = ['closed', 'sold', 'closed sale', 'terminated'];
  
  // Check if it's a closed/sold status
  if (CLOSED_STATUSES.includes(standardStatus) || CLOSED_STATUSES.includes(mlStatus)) {
    return true;
  }
  
  // Explicit check for active statuses (handles edge cases where board sends unexpected values)
  if (ACTIVE_STATUSES.includes(standardStatus) || ACTIVE_STATUSES.includes(mlStatus)) {
    return false;
  }
  
  // Default: treat unrecognized statuses as NOT sold (safe default)
  return false;
}

/**
 * Returns canonical status and isSold flag for a listing.
 * Used for defensive typing in Typesense schema compliance.
 */
function normalizeListingStatus(raw: any): { status: 'ACTIVE' | 'CLOSED' | 'UNKNOWN'; isSold: boolean } {
  const standardStatus = (raw.StandardStatus || '').toLowerCase().trim();
  const mlStatus = (raw.MlsStatus || '').toLowerCase().trim();
  
  const ACTIVE_STATUSES = ['new', 'active', 'price change', 'extension'];
  const CLOSED_STATUSES = ['closed', 'sold', 'closed sale', 'terminated'];
  
  if (CLOSED_STATUSES.includes(standardStatus) || CLOSED_STATUSES.includes(mlStatus)) {
    return { status: 'CLOSED', isSold: true };
  }
  
  if (ACTIVE_STATUSES.includes(standardStatus) || ACTIVE_STATUSES.includes(mlStatus)) {
    return { status: 'ACTIVE', isSold: false };
  }
  
  return { status: 'UNKNOWN', isSold: false };
}

/**
 * Extracts sold listing data from a raw listing for raw_vow_sold table.
 */
function extractSoldListingData(raw: any): SoldListingRecord | null {
  try {
    // isSoldListing reads raw.StandardStatus / raw.MlsStatus — it must receive the
    // raw listing OBJECT, not an extracted status string. Passing a string made it
    // always return false, so extractSoldListingData returned null for every record
    // and the raw_vow_sold upsert was silently skipped on every daily sync.
    if (!isSoldListing(raw)) {
      return null;
    }

    // Build the full raw_vow_sold record field-by-field (CLAUDE.md §6).
    const record: SoldListingRecord = {
      listing_key: raw.ListingKey || raw.ListingId || '',
      property_hash: generatePropertyHash(raw),
      unparsed_address:
        raw.UnparsedAddress ||
        [raw.StreetNumber, raw.StreetName, raw.UnitNumber].filter(Boolean).join(' ') ||
        null,
      city_region: raw.CityRegion || raw.MarketArea || '',
      city: raw.City || null,
      postal_code: raw.PostalCode || null,
      property_sub_type: raw.PropertySubType || raw.PropertyType || '',
      architectural_style: styleToString(raw.ArchitecturalStyle),
      approximate_age: raw.ApproximateAge || null,
      living_area_range: livingAreaRangeToInt(raw.LivingAreaRange),
      building_area_total: numOrNull(raw.BuildingAreaTotal),
      lot_width: numOrNull(raw.LotWidth),
      lot_depth: numOrNull(raw.LotDepth),
      bedrooms_above_grade: numOrNull(raw.BedroomsAboveGrade),
      bedrooms_below_grade: numOrNull(raw.BedroomsBelowGrade),
      bathrooms_total_integer: numOrNull(raw.BathroomsTotalInteger),
      rooms_above_grade: numOrNull(raw.RoomsAboveGrade),
      rooms_below_grade: numOrNull(raw.RoomsBelowGrade),
      kitchens_above_grade: numOrNull(raw.KitchensAboveGrade),
      kitchens_below_grade: numOrNull(raw.KitchensBelowGrade),
      parking_total: numOrNull(raw.ParkingTotal),
      covered_spaces: numOrNull(raw.CoveredSpaces),
      tax_annual_amount: numOrNull(raw.TaxAnnualAmount),
      association_fee: numOrNull(raw.AssociationFee),
      list_price: numOrNull(raw.ListPrice),
      close_price: numOrNull(raw.ClosePrice) ?? 0,
      // PurchaseContractDate = when the deal was signed (the AVM event date).
      // null when absent — do NOT fabricate it (a wrong date pollutes the anchor).
      purchase_contract_date: raw.PurchaseContractDate || null,
      // close_date prefers the real CloseDate; falls back to the contract date
      // (real data) rather than "now" so we never invent a future closing.
      close_date: raw.CloseDate || raw.SoldDate || raw.PurchaseContractDate || null,
      has_finished_basement: deriveHasFinishedBasement(raw),
      // Deterministic condition tiers (no LLM) — always a number (neutral on no signal).
      interior_tier: deriveInteriorTier(raw),
      exterior_tier: deriveExteriorTier(raw),
      basement_tier: deriveBasementTier(raw),
      raw_payload: raw,
    };

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
            // Field-by-field, every raw_vow_sold column (CLAUDE.md §6 — never spread).
            // Do NOT alter the table schema — it is the immutable AVM anchor.
            listing_key: record.listing_key,
            property_hash: record.property_hash,
            unparsed_address: record.unparsed_address,
            city_region: record.city_region,
            city: record.city,
            postal_code: record.postal_code,
            property_sub_type: record.property_sub_type,
            architectural_style: record.architectural_style,
            approximate_age: record.approximate_age,
            living_area_range: record.living_area_range,
            building_area_total: record.building_area_total,
            lot_width: record.lot_width,
            lot_depth: record.lot_depth,
            bedrooms_above_grade: record.bedrooms_above_grade,
            bedrooms_below_grade: record.bedrooms_below_grade,
            bathrooms_total_integer: record.bathrooms_total_integer,
            rooms_above_grade: record.rooms_above_grade,
            rooms_below_grade: record.rooms_below_grade,
            kitchens_above_grade: record.kitchens_above_grade,
            kitchens_below_grade: record.kitchens_below_grade,
            parking_total: record.parking_total,
            covered_spaces: record.covered_spaces,
            tax_annual_amount: record.tax_annual_amount,
            association_fee: record.association_fee,
            list_price: record.list_price,
            close_price: record.close_price,
            purchase_contract_date: record.purchase_contract_date,
            close_date: record.close_date,
            has_finished_basement: record.has_finished_basement,
            interior_tier: record.interior_tier,
            exterior_tier: record.exterior_tier,
            basement_tier: record.basement_tier,
            raw_payload: record.raw_payload,
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

// FEED ISOLATION: Separate tokens for IDX (Active) and VOW (Sold) feeds
// IDX_TOKEN: Used ONLY for active inventory (StandardStatus eq 'Active')
// VOW_TOKEN: Used ONLY for historical closed/sold (StandardStatus eq 'Closed')
const IDX_TOKEN = (process.env.PROPTX_IDX_TOKEN || '').trim();
const VOW_TOKEN = (process.env.PROPTX_VOW_TOKEN || '').trim();

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
  const token = IDX_TOKEN; // IDX feed only
  
  if (!token) {
    throw new Error('PROPTX_IDX_TOKEN environment variable is not set');
  }
  
  if (!lastSyncTimestamp) {
    throw new Error('lastSyncTimestamp must be provided');
  }
  
  // Query A (Active Sync): StandardStatus eq 'Active' + ModificationTimestamp filter
  // Routes to Typesense listings table
  const statusFilter = `StandardStatus eq 'Active'`;
  const modFilter = `ModificationTimestamp gt ${lastSyncTimestamp}`;
  const combinedFilter = `${statusFilter} and (${modFilter})`;
  
  // The Property endpoint does NOT support $expand=Media on this feed (AMPRE
  // returns HTTP 400/1109: "The property 'Media' ... is not defined in type
  // 'Property'"). Media records live in the separate /Media resource and must
  // be batch-fetched after the property batch — see fetchMediaForKeys below.
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
 * Selection is status-only at the API ($filter); freshness is governed by
 * $orderby=PurchaseContractDate desc + client-side pruning against lastSyncDate.
 *
 * @param skip - Number of records to skip (for manual pagination)
 * @param lastSyncDate - Date string (YYYY-MM-DD); client-side cutoff on PurchaseContractDate
 * @returns Listings batch with pagination info
 */
export async function fetchSoldListingsBatch(
  skip: number = 0,
  lastSyncDate?: string
): Promise<ListingsBatch> {
  const token = VOW_TOKEN; // VOW feed only
  
  if (!token) {
    throw new Error('PROPTX_VOW_TOKEN environment variable is not set');
  }
  
  if (!lastSyncDate) {
    throw new Error('lastSyncDate must be provided (format: YYYY-MM-DD)');
  }

  // Query B (Sold Sync): StandardStatus eq 'Closed' OR MlsStatus eq 'Sold'
  // Routes to: raw_vow_sold (AVM anchor) + Typesense (is_sold: true)
  //
  // IMPORTANT: Date fields (CloseDate, PurchaseContractDate) are NOT filterable in
  // $filter on this board's RESO API ("Field not allowed in filter"). Filter is
  // status-only; date-based selection happens via $orderby + client-side pruning.
  //
  // Why PurchaseContractDate desc (not CloseDate desc):
  //   PurchaseContractDate = when buyer/seller agreed on price (the AVM event).
  //   CloseDate = when title transfers (30-90 days later, stale price signal).
  //   Sorting by PurchaseContractDate puts the freshest firm deals at the top so
  //   the client-side prune cutoff (sync_state.last_sync_timestamp) tracks the
  //   real transaction date, not a lagging closing date.
  const statusFilter = `(StandardStatus eq 'Closed' or MlsStatus eq 'Sold')`;
  const combinedFilter = statusFilter;

  const url = `${API_BASE_URL}/Property?$filter=${encodeURIComponent(combinedFilter)}&$orderby=PurchaseContractDate%20desc&$top=100&$skip=${skip}&$count=true`;

  console.log(`   🔍 Query B (Sold): ${url.substring(0, 80)}...`);
  console.log(`   → PurchaseContractDate cutoff: ${lastSyncDate} (skip: ${skip})`);
  
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
// PropertyRooms Enrichment (Active sync)
// ============================================================================
//
// fetchRoomsForKeys/toStoredRoom + their constants/types live in
// ./roomsEnrichment so the one-time backfill script (scripts/admin/
// backfill-listing-rooms.ts) can share them WITHOUT pulling in this file's
// Typesense-side-effect imports. The per-batch wrapper below stays here because
// it mutates the active-listing array in flight (ingester-specific glue).

/**
 * Attaches `rooms` onto each raw active listing (mutates in place) so they persist
 * into full_payload. Best-effort: any failure leaves listings room-less and is
 * logged, never throwing — room data is non-critical and the sync must not fail on it.
 */
async function enrichActiveListingsWithRooms(listings: any[]): Promise<number> {
  const keys = listings.map(l => l.ListingKey).filter(Boolean);
  if (keys.length === 0) return 0;
  try {
    const roomsMap = await fetchRoomsForKeys(keys);
    let withRooms = 0;
    for (const listing of listings) {
      const rooms = roomsMap.get(listing.ListingKey) || [];
      listing.rooms = rooms;
      if (rooms.length > 0) withRooms++;
    }
    return withRooms;
  } catch (err: any) {
    console.warn(`   ⚠️  Room enrichment failed (non-fatal): ${err.message}`);
    return 0;
  }
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
 *   $filter=(StandardStatus eq 'Closed' or MlsStatus eq 'Sold')   (status-only — dates not filterable)
 *   $orderby=PurchaseContractDate desc + client-side prune at [lastSyncDate]
 *   Routes to: raw_vow_sold (AVM anchor) + Typesense (is_sold: true) via sync.ts
 * 
 * Algorithm:
 * 1. Read last_sync_timestamp from Supabase
 * 2. Run Query A: Active listings via ModificationTimestamp
 *    a. Paginate through batches
 *    b. Process each batch via sync.ts (Supabase + Typesense)
 *    c. Sleep 1000ms between pages
 * 3. Run Query B: Sold listings via PurchaseContractDate (ordered desc, client-side pruned)
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

  // Captured outside the try so the catch block can still read it for the
  // sync_state cursor decision (CLAUDE.md §12 — failure must NOT advance).
  let previousCursor: string | null = null;

  try {
    // Read sync state from Supabase
    console.log('📖 Reading sync state from Supabase...');
    const state = await readSyncState();
    previousCursor = state.lastSyncTimestamp;
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

      // Enrich with per-room dimensions (separate /PropertyRooms resource) so they
      // persist into full_payload — the detail page then needs no per-view API call.
      // Best-effort: never blocks/fails the sync.
      console.log('   📐 Enriching batch with room dimensions...');
      const roomsAttached = await enrichActiveListingsWithRooms(batch.listings);
      console.log(`   📐 Rooms attached to ${roomsAttached}/${batch.listings.length} listings`);

      // Enrich with photo media (separate /Media resource — AMPRE does not support
      // $expand=Media on /Property). Attached as `media: StoredMedia[]` on each
      // raw listing; the transformer's selectPrimaryImage/collectMediaUrls helpers
      // read it from there and persist via full_payload + media_urls columns.
      console.log('   🖼️  Enriching batch with media (photo URLs)...');
      const mediaAttached = await enrichListingsWithMedia(batch.listings, IDX_TOKEN);
      console.log(`   🖼️  Media attached to ${mediaAttached}/${batch.listings.length} listings`);

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
    
    // ─── Query B: Sold Sync (via PurchaseContractDate) ───────────────────────
    console.log('\n════════════════════════════════════════════════');
    console.log('  QUERY B: Sold Listings Sync');
    console.log('════════════════════════════════════════════════\n');
    
    // Convert timestamp to date string for PurchaseContractDate cutoff (YYYY-MM-DD).
    // PurchaseContractDate is a Date string, not a full ISO timestamp.
    const lastSyncDate = state.lastSyncTimestamp.split('T')[0] || state.lastSyncTimestamp.substring(0, 10);
    console.log(`   📅 Using lastSyncDate: ${lastSyncDate} (PurchaseContractDate cutoff)`);
    
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

      // Enrich sold batch with media (uses VOW token since sold listings are only
      // accessible via the VOW feed). Same best-effort pattern as the active path.
      console.log('   🖼️  Enriching sold batch with media...');
      const soldMediaAttached = await enrichListingsWithMedia(batch.listings, VOW_TOKEN);
      console.log(`   🖼️  Media attached to ${soldMediaAttached}/${batch.listings.length} listings`);

      // Process batch through ETL pipeline (sync.ts) with is_sold flag
      console.log('   🔄 Processing sold batch through ETL pipeline...');
      const syncResult = await processBatch(batch.listings, { isSold: true });
      
      if (!syncResult.success) {
        result.errors.push(...syncResult.supabase.errors);
        result.errors.push(...syncResult.typesense.errors);
      }
      
      // Extract sold data for raw_vow_sold (AVM anchor table). In the same pass,
      // build lean docs for the bounded `sold_listings` Typesense collection —
      // ListOfficeName comes straight off the in-memory raw JSON (no JSONB detoast).
      const soldRecords: SoldListingRecord[] = [];
      const soldDocs: SoldListingDocument[] = [];
      for (const rawListing of batch.listings) {
        const soldData = extractSoldListingData(rawListing);
        if (soldData) {
          soldRecords.push(soldData);
          const doc = toSoldDocument(
            soldData,
            rawListing.ListOfficeName ?? null,
            { media: (rawListing as any).media, images: (rawListing as any).images }
          );
          if (doc) soldDocs.push(doc);
        }
      }

      if (soldRecords.length > 0) {
        console.log(`   🏠 Found ${soldRecords.length} sold/closed listings for raw_vow_sold`);
        const upsertResult = await upsertSoldListings(supabaseClient, soldRecords);
        console.log(`   📊 raw_vow_sold upsert result: ${JSON.stringify(upsertResult)}`);
      }

      // Index the same batch into Typesense `sold_listings` (non-fatal on error —
      // raw_vow_sold remains the source of truth and the backfill can rebuild it).
      if (soldDocs.length > 0) {
        try {
          const { success, failed } = await importSoldBatch(getSoldAdminClient(), soldDocs);
          console.log(`   🔎 sold_listings indexed: ${success} ok, ${failed} failed`);
        } catch (err: any) {
          console.warn(`   ⚠️  sold_listings indexing failed (non-fatal): ${err.message}`);
        }
      }
      
      // ─── Client-Side Pruning (PurchaseContractDate guard) ──────────────────
      // Date fields cannot be used in $filter (board rejects them), so we rely on
      // server-side sorting ($orderby=PurchaseContractDate desc) + client-side
      // pruning. Once we hit a PurchaseContractDate older than our cutoff, every
      // subsequent record is older too (sorted desc) and we can stop paginating.
      const cutoffDate = new Date(lastSyncDate);
      let hitOldCutoff = false;

      for (const listing of batch.listings) {
        const contractDate = listing.PurchaseContractDate;
        if (contractDate) {
          const listingDate = new Date(contractDate);
          if (listingDate < cutoffDate) {
            console.log(`   🛑 Client-side pruning: Found PurchaseContractDate ${contractDate} older than cutoff ${lastSyncDate}`);
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

    // Keep the bounded sold_listings collection within its rolling window (non-fatal).
    try {
      await pruneOldSold(getSoldAdminClient());
    } catch (err: any) {
      console.warn(`   ⚠️  sold_listings prune failed (non-fatal): ${err.message}`);
    }

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
    const successCursor = nextSyncCursor('completed', previousCursor, now);
    await updateSyncState(successCursor, result.activeRecords + result.soldRecords, 'completed');

    return result;

  } catch (err: any) {
    console.error('\n❌ Dual-Query sync failed:', err.message);
    result.success = false;
    result.errors.push(err.message);

    // Preserve the previous cursor on failure so the next attempt re-runs the
    // same window. Advancing on failure leaves an unrecoverable gap (§12).
    const failureCursor = nextSyncCursor('failed', previousCursor, new Date().toISOString());
    await updateSyncState(failureCursor, result.activeRecords + result.soldRecords, 'failed');

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
    // Test fetch with IDX token
    const token = IDX_TOKEN;
    if (!token) {
      console.error('❌ PROPTX_IDX_TOKEN not configured');
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