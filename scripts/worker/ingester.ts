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
import { SOLD_LISTINGS_COLLECTION } from '@/lib/typesense/soldListingsSchema';
import {
  deriveInteriorTier,
  deriveExteriorTier,
  deriveBasementTier,
  deriveHasFinishedBasement,
} from '@/lib/avm/conditionScoring';
import { generatePropertyHash } from '@/lib/typesense/TemporalDistressEngine';
import { fetchRoomsForKeys } from './roomsEnrichment';
import { enrichListingsWithMedia, preserveExistingMedia } from './mediaEnrichment';
import { nextSyncCursor } from './syncCursor';
import { describeError } from '@/lib/etl/describeError';
import { runDelistedSync, pruneOldDelisted } from './delistedIndexer';
import { isDelistedDealType } from '@/lib/sold/dealType';

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
export function isSoldListing(raw: any): boolean {
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
export function extractSoldListingData(raw: any): SoldListingRecord | null {
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
export async function upsertSoldListings(
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

// Media reconciliation (Query A2): re-fetch /Media for recently-created active
// listings still missing photos (new-listing AMPRE propagation lag). Bounded so
// the nightly sweep stays cheap and genuinely photo-less listings age OUT of the
// window instead of being re-probed forever.
const MEDIA_RECONCILE_WINDOW_DAYS = 21;
const MEDIA_RECONCILE_PAGE = 100;           // keys (and full_payloads) hydrated per page
const MEDIA_RECONCILE_MAX = 1000;           // total rows scanned per night (safety cap)
const MEDIA_RECONCILE_PAGE_DELAY_MS = 300;  // polite pacing between pages
// Query B2 (sold): cap on photo-less in-window sold listings re-checked per night.
// Candidates come from the in-memory sold_listings Typesense export (no raw_vow_sold
// scan); we pull raw_payload only for this many, by primary key.
const SOLD_RECONCILE_MAX = 500;

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

// ─── Query B (Sold Sync): cursor-advance pagination ──────────────────────────
// Query B previously deep-$skip-paginated `ModificationTimestamp gt masterCursor`
// with no $orderby, then the master cursor jumped to end-of-run `now`. Over a
// multi-hour catch-up the unordered result set MUTATES under the crawl (records
// modified mid-run shift across page boundaries), so records could skip past the
// pagination — and the cursor jump made every such miss PERMANENT (the 6 Alexie
// Way class: 26k closed listings still indexed For Sale, found 2026-07-17).
// Reworked to mirror Query C (delistedIndexer.ts), the proven drift-proof shape:
//   - $orderby=ModificationTimestamp asc, cursor advances per persisted page —
//     a record modified during the run simply reappears LATER in the walk;
//   - boundary-second drain via `eq` + $skip (second-precision feed, bulk status
//     changes can exceed 100 records/second);
//   - OWN sync_state row (id='sold'), seeded from the master cursor on first
//     run: a Query B failure never moves the master cursor and vice versa, and
//     the cursor only ever advances past fully-persisted pages.

const SOLD_CURSOR_ROW_ID = 'sold';
const SOLD_STATUS_FILTER = `(StandardStatus eq 'Closed' or MlsStatus eq 'Sold')`;
/** Nightly page cap: ~1.2k sold+leased/day needs ~12 pages; 150 gives multi-day
 *  catch-up slack (15k records). A capped run reports caughtUp=false and resumes
 *  from its own cursor next night — nothing is lost. */
const SOLD_DELTA_MAX_PAGES = 150;

export async function readSoldCursor(defaultIso: string): Promise<string> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from('sync_state')
    .select('last_sync_timestamp')
    .eq('id', SOLD_CURSOR_ROW_ID)
    .maybeSingle();
  if (error) throw new Error(`read sold cursor: ${error.message}`);
  if (!data) {
    const { error: insErr } = await supabase
      .from('sync_state')
      .insert({ id: SOLD_CURSOR_ROW_ID, last_sync_timestamp: defaultIso, status: 'idle' });
    if (insErr) throw new Error(`init sold cursor: ${insErr.message}`);
    return defaultIso;
  }
  return data.last_sync_timestamp;
}

export async function updateSoldCursor(
  timestamp: string,
  status: 'running' | 'completed' | 'failed'
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from('sync_state')
    .update({ last_sync_timestamp: timestamp, status, updated_at: new Date().toISOString() })
    .eq('id', SOLD_CURSOR_ROW_ID);
  if (error) throw new Error(`update sold cursor: ${error.message}`);
}

/** One ordered sold page (VOW). Single $orderby only — AMPRE rejects compound
 *  $orderby (error 1109, probe-verified 2026-06-10); $skip is used ONLY inside
 *  the bounded boundary-second drain, never for deep pagination. */
async function fetchSoldPage(filter: string, skip = 0): Promise<any[]> {
  const token = VOW_TOKEN;
  if (!token) throw new Error('PROPTX_VOW_TOKEN environment variable is not set');
  const url =
    `${API_BASE_URL}/Property?$filter=${encodeURIComponent(filter)}` +
    `&$orderby=${encodeURIComponent('ModificationTimestamp asc')}&$top=100` +
    (skip > 0 ? `&$skip=${skip}` : '');
  const result = await fetchWithRetry<any>(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!result.success || !result.data) {
    throw new Error(`Query B fetch failed: ${result.error}`);
  }
  return result.data.value ?? [];
}

export interface SoldSyncResult {
  records: number;
  pages: number;
  caughtUp: boolean;
  errors: string[];
}

/**
 * Catch up sold/closed listings from the 'sold' cursor, up to maxPages.
 * Each persisted page routes through the standard pipeline: media enrichment →
 * processBatch({isSold}) (vault refresh + stale For-Sale doc delete) →
 * raw_vow_sold upsert (AVM anchor) → sold_listings Typesense import.
 * The cursor only advances after a page fully persists (upserts make re-runs safe).
 */
export async function runSoldSync(
  defaultIso: string,
  maxPages = SOLD_DELTA_MAX_PAGES
): Promise<SoldSyncResult> {
  let cursor = await readSoldCursor(defaultIso);
  console.log(`   📖 Sold cursor: ${cursor}`);
  await updateSoldCursor(cursor, 'running');
  const supabaseClient = getServiceRoleClient();
  const result: SoldSyncResult = { records: 0, pages: 0, caughtUp: false, errors: [] };

  /** Persist one page — the exact per-page body the $skip loop used to run. */
  const persistSoldPage = async (listings: any[]): Promise<void> => {
    const statuses = [...new Set(listings.map(l => l.StandardStatus || l.MlsStatus || l.Status))];
    console.log(`   📋 Statuses in batch: ${statuses.join(', ')}`);

    // Media (VOW feed — sold listings are not on IDX). Best-effort.
    const soldMediaAttached = await enrichListingsWithMedia(listings, VOW_TOKEN);
    console.log(`   🖼️  Media attached to ${soldMediaAttached}/${listings.length} listings`);
    const preservedSold = await preserveExistingMedia(
      listings,
      supabaseClient,
      'raw_vow_sold',
      'raw_payload'
    );
    if (preservedSold > 0) {
      console.log(`   🛡️  Preserved existing sold media on ${preservedSold} listings`);
    }

    // Vault refresh + stale For-Sale doc delete (collectStaleSearchDocIds path).
    const syncResult = await processBatch(listings, { isSold: true });
    if (!syncResult.success) {
      result.errors.push(...syncResult.supabase.errors, ...syncResult.typesense.errors);
    }

    // raw_vow_sold (AVM anchor) + lean sold_listings docs in the same pass.
    const soldRecords: SoldListingRecord[] = [];
    const soldDocs: SoldListingDocument[] = [];
    for (const rawListing of listings) {
      const soldData = extractSoldListingData(rawListing);
      if (soldData) {
        soldRecords.push(soldData);
        const doc = toSoldDocument(
          { ...soldData, mls_status: rawListing.MlsStatus ?? null, transaction_type: rawListing.TransactionType ?? null },
          rawListing.ListOfficeName ?? null,
          { media: (rawListing as any).media, images: (rawListing as any).images }
        );
        if (doc) soldDocs.push(doc);
      }
    }
    if (soldRecords.length > 0) {
      const upsertResult = await upsertSoldListings(supabaseClient, soldRecords);
      console.log(`   📊 raw_vow_sold upsert result: ${JSON.stringify(upsertResult)}`);
      if (upsertResult.failed > 0) result.errors.push(...upsertResult.errors);
    }
    if (soldDocs.length > 0) {
      try {
        const { success, failed } = await importSoldBatch(getSoldAdminClient(), soldDocs);
        console.log(`   🔎 sold_listings indexed: ${success} ok, ${failed} failed`);
      } catch (err: any) {
        console.warn(`   ⚠️  sold_listings indexing failed (non-fatal): ${err.message}`);
      }
    }
  };

  try {
    while (result.pages < maxPages) {
      const listings = await fetchSoldPage(
        `${SOLD_STATUS_FILTER} and ModificationTimestamp gt ${cursor}`
      );
      if (listings.length === 0) {
        result.caughtUp = true;
        break;
      }
      await persistSoldPage(listings);
      result.records += listings.length;
      result.pages++;

      const lastTs = listings[listings.length - 1]?.ModificationTimestamp;
      if (!lastTs) {
        console.warn('   ⚠️  Page has no ModificationTimestamp on its last record — stopping.');
        result.caughtUp = listings.length < 100;
        break;
      }
      console.log(`   📄 Sold page ${result.pages}: +${listings.length} (cursor → ${lastTs})`);

      if (listings.length < 100) {
        // Short page = feed exhausted; the boundary second arrived complete.
        cursor = lastTs;
        result.caughtUp = true;
        break;
      }

      // Full page: drain the boundary second fully via `eq` + $skip before the
      // cursor advances past it (overlap with rows above is idempotent).
      let drainComplete = false;
      const eqFilter = `${SOLD_STATUS_FILTER} and ModificationTimestamp eq ${lastTs}`;
      for (let skip = 0; result.pages < maxPages; skip += 100) {
        await sleep(PAGE_DELAY_MS);
        const drain = await fetchSoldPage(eqFilter, skip);
        if (drain.length > 0) {
          await persistSoldPage(drain);
          result.records += drain.length;
          result.pages++;
          console.log(`   📄 Sold drain: +${drain.length} @ ${lastTs} (skip ${skip})`);
        }
        if (drain.length < 100) {
          drainComplete = true;
          break;
        }
      }
      if (!drainComplete) {
        // Page cap hit mid-drain — leave the cursor BEFORE lastTs so the next
        // run re-fetches and re-drains that second (idempotent), never skips it.
        break;
      }
      cursor = lastTs;
      await sleep(PAGE_DELAY_MS);
    }
    await updateSoldCursor(cursor, 'completed');
  } catch (err: any) {
    console.error(`   ❌ Sold sync failed: ${err?.message || err}`);
    // Cursor intentionally NOT advanced past the last fully-persisted page.
    await updateSoldCursor(cursor, 'failed').catch(() => {});
    throw err;
  }
  return result;
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

  // This is the FIRST DB call of the run and the cursor's only source of truth. A
  // transient network blip here (e.g. "Premature close", ECONNRESET) used to fail the
  // ENTIRE nightly sync — and because the cursor was never read, the failure path then
  // clobbered it with `now` (gap). Retry transient errors with backoff before giving
  // up; a real Postgres error (carries a `code`) is not transient and is rethrown at once.
  const MAX_ATTEMPTS = 4;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
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
    } catch (err: any) {
      lastErr = err;
      // A structured Postgres error (has a non-PGRST116 `code`) is a real, non-transient
      // failure — don't waste retries on it.
      if (err && typeof err === 'object' && 'code' in err && err.code && err.code !== 'PGRST116') {
        throw err;
      }
      if (attempt < MAX_ATTEMPTS) {
        const backoff = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
        console.warn(
          `   ⏳ readSyncState attempt ${attempt}/${MAX_ATTEMPTS} failed: ${describeError(err)} — retrying in ${backoff}ms…`
        );
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
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
  // Query A2: # of recently-created active listings whose missing photos were
  // recovered from AMPRE this run (see reconcileMissingMedia).
  reconciledMedia?: number;
  // Query B2: # of in-window sold listings whose missing photos were recovered
  // from AMPRE this run (see reconcileMissingSoldMedia).
  reconciledSoldMedia?: number;
}

/**
 * Query A2 — Media reconciliation (self-heals new-listing photo lag).
 *
 * New listings frequently appear in /Property BEFORE their photos have
 * propagated to AMPRE's separate /Media resource, so Query A first stores them
 * with `media: []`. A later photos-only update on AMPRE bumps
 * PhotosChangeTimestamp — NOT ModificationTimestamp — so Query A's
 * `ModificationTimestamp gt cursor` filter never revisits them, and they would
 * stay imageless forever (the "NO MEDIA" detail-page fallback). preserveExistingMedia
 * can't help either: a first-ingest row has no prior media to restore.
 *
 * This pass re-fetches /Media for recently-created Active listings still missing
 * media and re-runs ONLY the recovered ones through the normal ETL upsert
 * (processBatch), repopulating full_payload.media + media_urls + the Typesense
 * doc. Bounded by a recency window (genuinely photo-less listings age out instead
 * of being re-probed nightly) and a hard row cap. Fully best-effort: any failure
 * is swallowed and never blocks, fails, or advances the sync cursor.
 */
async function reconcileMissingMedia(
  idxToken: string
): Promise<{ scanned: number; recovered: number }> {
  if (!idxToken) {
    console.warn('   ⚠️  Media reconciliation skipped: PROPTX_IDX_TOKEN not set');
    return { scanned: 0, recovered: 0 };
  }
  try {
    const supabase = getServiceRoleClient();
    const cutoffIso = new Date(
      Date.now() - MEDIA_RECONCILE_WINDOW_DAYS * 86_400_000
    ).toISOString();

    // Keyset-paginate by listing_key (indexed via the UNIQUE constraint) while
    // FILTERING on created_at — never ORDER on created_at, which is unindexed and
    // trips the statement timeout (CLAUDE.md §12). Paginating every page (instead of
    // one capped fetch) guarantees no key-prefix is starved of the cap: a single
    // `ORDER BY listing_key LIMIT 500` was entirely consumed by C-prefix keys and
    // never reached N-/W-/X- listings.
    let cursor = '';
    let scanned = 0;
    let recovered = 0;

    while (scanned < MEDIA_RECONCILE_MAX) {
      const pageSize = Math.min(MEDIA_RECONCILE_PAGE, MEDIA_RECONCILE_MAX - scanned);
      const { data: rows, error } = await supabase
        .from('listings')
        .select('listing_key, full_payload')
        .or('media_urls.is.null,media_urls.eq.{}')
        .gte('created_at', cutoffIso)
        .gt('listing_key', cursor)
        .order('listing_key', { ascending: true })
        .limit(pageSize);

      if (error) {
        console.warn(`   ⚠️  Reconciliation query failed (non-fatal): ${error.message}`);
        break;
      }
      if (!rows || rows.length === 0) break;
      cursor = rows[rows.length - 1].listing_key;
      scanned += rows.length;

      const listings = rows
        .map((r: any) => r.full_payload)
        .filter((p: any) => p && p.ListingKey);

      if (listings.length > 0) {
        // Re-fetch /Media (attaches `media` in place) and re-upsert ONLY the ones
        // that actually gained photos — still-empty rows are left untouched (no
        // needless write / AVM recompute; they recover on a future night once AMPRE
        // has their photos, or age out of the window).
        await enrichListingsWithMedia(listings, idxToken);
        const gained = listings.filter(
          (l: any) => Array.isArray(l?.media) && l.media.length > 0
        );
        if (gained.length > 0) {
          const syncResult = await processBatch(gained);
          if (!syncResult.success) {
            const errs = [...syncResult.supabase.errors, ...syncResult.typesense.errors];
            console.warn(`   ⚠️  Reconciliation upsert errors: ${errs.slice(0, 3).join('; ')}`);
          }
          recovered += gained.length;
        }
      }

      if (rows.length < pageSize) break; // last page
      await sleep(MEDIA_RECONCILE_PAGE_DELAY_MS);
    }

    if (scanned >= MEDIA_RECONCILE_MAX) {
      console.log(`   ℹ️  Hit the ${MEDIA_RECONCILE_MAX}-row reconciliation cap; remaining empties roll to the next sync.`);
    }
    console.log(`   🩹 Scanned ${scanned} recent empty-media listings, recovered ${recovered}`);
    return { scanned, recovered };
  } catch (err: any) {
    console.warn(`   ⚠️  Media reconciliation failed (non-fatal): ${err?.message || err}`);
    return { scanned: 0, recovered: 0 };
  }
}

/**
 * Query B2 — Sold media reconciliation (Typesense-driven; no raw_vow_sold scan).
 *
 * Counterpart to reconcileMissingMedia for SOLD inventory. raw_vow_sold has no
 * media column and no purchase_contract_date index, and a JSONB scan across its
 * ~217k rows blows the IO budget (CLAUDE.md §12). So instead of scanning the
 * table, we read the candidate set from the in-memory `sold_listings` Typesense
 * collection (already a bounded rolling 180-day window): any doc lacking
 * `primaryImageUrl` has no photo. We then touch raw_vow_sold ONLY by primary key
 * for that small set, re-fetch /Media via the VOW token (failure-aware, #2), and
 * re-upsert the recovered ones through the SAME path as the daily Query B
 * (upsertSoldListings + importSoldBatch). Best-effort: never throws.
 *
 * `primaryImageUrl` is index:false so it can't be filter_by'd — we export id +
 * primaryImageUrl + PurchaseContractDate and filter client-side, freshest first
 * (recent sales are the most likely to still have recoverable media; genuinely
 * photo-less old ones age out of the 180-day window).
 */
async function reconcileMissingSoldMedia(
  vowToken: string
): Promise<{ scanned: number; recovered: number }> {
  if (!vowToken) {
    console.warn('   ⚠️  Sold media reconciliation skipped: PROPTX_VOW_TOKEN not set');
    return { scanned: 0, recovered: 0 };
  }
  try {
    const ts = getSoldAdminClient();

    // 1. Export the in-window sold docs (in-memory — NOT a Supabase read) and
    //    collect the ones with no photo.
    let exported: string;
    try {
      exported = (await ts
        .collections(SOLD_LISTINGS_COLLECTION)
        .documents()
        .export({ include_fields: 'id,primaryImageUrl,PurchaseContractDate,DealType' })) as unknown as string;
    } catch (err: any) {
      console.warn(`   ⚠️  Sold reconciliation export failed (non-fatal): ${err?.message || err}`);
      return { scanned: 0, recovered: 0 };
    }

    const candidates: Array<{ id: string; pcd: number }> = [];
    for (const line of String(exported).split('\n')) {
      if (!line) continue;
      let d: any;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      // De-listed docs are photo-less by design — never reconciliation candidates (they'd starve the 500-slot budget).
      if (isDelistedDealType(d?.DealType)) continue;
      if (d?.id && !d.primaryImageUrl) candidates.push({ id: d.id, pcd: Number(d.PurchaseContractDate) || 0 });
    }
    if (candidates.length === 0) {
      console.log('   ✅ No in-window sold listings are missing photos.');
      return { scanned: 0, recovered: 0 };
    }
    candidates.sort((a, b) => b.pcd - a.pcd); // freshest sales first
    const ids = candidates.slice(0, SOLD_RECONCILE_MAX).map((c) => c.id);
    if (candidates.length > SOLD_RECONCILE_MAX) {
      console.log(`   ℹ️  ${candidates.length} in-window sold lack photos; processing the ${SOLD_RECONCILE_MAX} freshest this run.`);
    }

    // 2. Pull raw_payload ONLY for the capped candidate set, by primary key
    //    (no table scan — IO-safe). Chunk the .in() to keep URLs sane.
    const supabase = getServiceRoleClient();
    const rawListings: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data, error } = await supabase
        .from('raw_vow_sold')
        .select('listing_key, raw_payload')
        .in('listing_key', chunk);
      if (error) {
        console.warn(`   ⚠️  Sold raw_payload fetch failed (non-fatal): ${error.message}`);
        continue;
      }
      for (const row of data ?? []) {
        const p = (row as any).raw_payload;
        if (p && p.ListingKey) rawListings.push(p);
      }
    }
    if (rawListings.length === 0) return { scanned: ids.length, recovered: 0 };

    // 3. Many candidates already HAVE media in raw_payload but were indexed before
    //    it was attached (so their sold-card doc lacks primaryImageUrl) — re-index
    //    those LOCALLY, no AMPRE call. Only VOW-fetch the genuinely media-less ones.
    const hasMedia = rawListings.filter((l) => Array.isArray(l?.media) && l.media.length > 0);
    const needsFetch = rawListings.filter((l) => !Array.isArray(l?.media) || l.media.length === 0);
    if (needsFetch.length > 0) await enrichListingsWithMedia(needsFetch, vowToken);
    const fetched = needsFetch.filter((l) => Array.isArray(l?.media) && l.media.length > 0);
    const fetchedKeys = new Set(fetched.map((l) => l.ListingKey));
    const toIndex = [...hasMedia, ...fetched];
    if (toIndex.length === 0) return { scanned: ids.length, recovered: 0 };

    // 4. Re-index sold_listings for ALL now-photo'd docs; re-upsert raw_vow_sold
    //    ONLY for the freshly-fetched ones (existing-media rows already carry it,
    //    so we don't needlessly re-write the §12 table).
    const soldRecords: SoldListingRecord[] = [];
    const soldDocs: SoldListingDocument[] = [];
    for (const raw of toIndex) {
      const soldData = extractSoldListingData(raw);
      if (!soldData) continue;
      const doc = toSoldDocument(
        { ...soldData, mls_status: raw.MlsStatus ?? null, transaction_type: raw.TransactionType ?? null },
        raw.ListOfficeName ?? null,
        { media: raw.media, images: raw.images }
      );
      if (doc) soldDocs.push(doc);
      if (fetchedKeys.has(raw.ListingKey)) soldRecords.push(soldData);
    }
    if (soldRecords.length > 0) await upsertSoldListings(supabase, soldRecords);
    if (soldDocs.length > 0) {
      try {
        await importSoldBatch(ts, soldDocs);
      } catch (err: any) {
        console.warn(`   ⚠️  Sold reconciliation index failed (non-fatal): ${err?.message || err}`);
      }
    }
    console.log(
      `   🩹 Re-indexed ${soldDocs.length}/${ids.length} sold (${fetched.length} via fresh /Media, ${hasMedia.length} already had media)`
    );
    return { scanned: ids.length, recovered: soldDocs.length };
  } catch (err: any) {
    console.warn(`   ⚠️  Sold media reconciliation failed (non-fatal): ${err?.message || err}`);
    return { scanned: 0, recovered: 0 };
  }
}

/**
 * Executes a Dual-Query delta sync.
 * 
 * Query A (Active Sync):
 *   $filter=StandardStatus eq 'Active' and ModificationTimestamp gt [lastSyncTimestamp]
 *   Routes to: Typesense listings table (via sync.ts)
 * 
 * Query B (Sold Sync):
 *   $filter=(StandardStatus eq 'Closed' or MlsStatus eq 'Sold') and ModificationTimestamp gt [lastSyncTimestamp]
 *   Same monotonic cursor as Query A/C (no PurchaseContractDate early-stop — that dropped late sales)
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
    lastSyncTimestamp: '',
    reconciledMedia: 0,
    reconciledSoldMedia: 0
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

      // Clobber protection: for listings whose AMPRE fetch returned empty,
      // restore previously-stored media from Supabase so the impending UPSERT
      // doesn't wipe a successful prior sync's / backfill's photos.
      const preservedActive = await preserveExistingMedia(
        batch.listings,
        getServiceRoleClient()
      );
      if (preservedActive > 0) {
        console.log(`   🛡️  Preserved existing media on ${preservedActive} listings (AMPRE empty)`);
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
      
      // nextLink is the authoritative "more pages" signal; the ===100 heuristic stays
      // as a fallback for endpoints that omit nextLink (the /Media endpoint does — see
      // memory media-reconciliation-gap). Resolves audit MEDIUM-7.
      activeHasMore = batch.nextLink != null || batch.listings.length === 100;
      
      console.log(`   📊 Running totals: ${result.activeRecords} active records, ${result.activePages} pages`);
      
      // Rate limit delay
      console.log(`   ⏳ Rate limiting: sleeping ${PAGE_DELAY_MS}ms...`);
      await sleep(PAGE_DELAY_MS);
      
    } while (activeHasMore);
    
    console.log(`\n✅ Query A Complete: ${result.activeRecords} active records, ${result.activePages} pages`);

    // ─── Query A2: Media Reconciliation (self-heal new-listing photo lag) ────
    console.log('\n════════════════════════════════════════════════');
    console.log('  QUERY A2: Media Reconciliation');
    console.log('════════════════════════════════════════════════\n');
    const recon = await reconcileMissingMedia(IDX_TOKEN);
    result.reconciledMedia = recon.recovered;
    console.log(`\n✅ Query A2 Complete: recovered media on ${recon.recovered}/${recon.scanned} recent empty-media listings`);

    // ─── Query B: Sold Sync (via ModificationTimestamp — mirrors Query A/C) ──
    console.log('\n════════════════════════════════════════════════');
    console.log('  QUERY B: Sold Listings Sync');
    console.log('════════════════════════════════════════════════\n');

    // Query B runs on its OWN cursor row (sync_state id='sold'), seeded from the
    // master cursor on first run, with ordered per-page cursor-advance pagination
    // (see runSoldSync above — the drift-proof Query C shape). A Query B failure
    // no longer aborts the whole sync: its own cursor already protects the sold
    // window, so we record the error (CLI exits 1 → failure notifier fires) and
    // let A's finalize proceed.
    try {
      const soldRes = await runSoldSync(state.lastSyncTimestamp);
      result.soldRecords = soldRes.records;
      result.soldPages = soldRes.pages;
      result.errors.push(...soldRes.errors);
      console.log(
        `\n✅ Query B Complete: ${soldRes.records} sold records, ${soldRes.pages} pages, caughtUp=${soldRes.caughtUp}`
      );
      if (!soldRes.caughtUp) {
        console.warn(
          '   ⚠️  Sold page cap hit — run did NOT catch up; resumes from the sold cursor next run.'
        );
      }
    } catch (err: any) {
      console.error(`\n❌ Query B failed: ${err?.message || err}`);
      result.success = false;
      result.errors.push(`sold sync: ${err?.message || err}`);
    }

    // Keep the bounded sold_listings collection within its rolling window (non-fatal).
    try {
      await pruneOldSold(getSoldAdminClient());
    } catch (err: any) {
      console.warn(`   ⚠️  sold_listings prune failed (non-fatal): ${err.message}`);
    }

    // ─── Query B2: Sold Media Reconciliation (Typesense-driven, no DB scan) ──
    // Recover photos for in-window sold listings whose media was missed (e.g. a
    // transient Query B fetch failure). Runs AFTER prune so only live window docs
    // are considered. Best-effort: never fails or advances the cursor.
    console.log('\n════════════════════════════════════════════════');
    console.log('  QUERY B2: Sold Media Reconciliation');
    console.log('════════════════════════════════════════════════\n');
    const soldRecon = await reconcileMissingSoldMedia(VOW_TOKEN);
    result.reconciledSoldMedia = soldRecon.recovered;
    console.log(`\n✅ Query B2 Complete: recovered media on ${soldRecon.recovered}/${soldRecon.scanned} in-window sold listings`);

    // ─── Query C: De-listed Sync (Terminated/Expired/Suspended) ─────────────
    // Own cursor (sync_state id='delisted') and own try/catch: a Query C
    // failure must never fail the A/B sync or move the master cursor.
    console.log('\n════════════════════════════════════════════════');
    console.log('  QUERY C: De-listed Listings Sync');
    console.log('════════════════════════════════════════════════\n');
    try {
      const delisted = await runDelistedSync();
      await pruneOldDelisted();
      console.log(
        `\n✅ Query C Complete: ${delisted.records} de-listed records, ${delisted.indexed} indexed, caughtUp=${delisted.caughtUp}`
      );
    } catch (err: any) {
      console.warn(`\n⚠️  Query C failed (non-fatal for the A/B sync): ${err?.message || err}`);
      result.errors.push(`delisted sync: ${err?.message || err}`);
    }

    // ─── Finalize ───────────────────────────────────────────────────────────
    const now = new Date().toISOString();
    result.lastSyncTimestamp = now;
    
    console.log('\n========================================');
    console.log('  Dual-Query Sync Complete!');
    console.log('========================================');
    console.log(`   Active records: ${result.activeRecords} (${result.activePages} pages)`);
    console.log(`   Sold records: ${result.soldRecords} (${result.soldPages} pages)`);
    console.log(`   Media reconciled: ${result.reconciledMedia ?? 0} active, ${result.reconciledSoldMedia ?? 0} sold`);
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
    // describeError unwraps non-Error throws (a Cloudflare 522 body has no
    // `.message`, which is why this used to log `Dual-Query sync failed: undefined`).
    const message = describeError(err);
    console.error('\n❌ Dual-Query sync failed:', message);
    result.success = false;
    result.errors.push(message);

    // Preserve the previous cursor on failure so the next attempt re-runs the
    // same window. Advancing on failure leaves an unrecoverable gap (§12).
    // Best-effort: if the DB itself is down, this write will 522 too — don't let
    // that throw mask the original failure.
    try {
      if (previousCursor === null) {
        // readSyncState() never returned the real cursor (it threw, even after retries).
        // Writing `now` here would CLOBBER the stored cursor and skip every listing
        // modified since the last good sync (CLAUDE.md §12). Leave sync_state's timestamp
        // untouched so the next run re-reads the TRUE cursor and re-runs the window.
        console.error(
          '   ⚠️  Cursor unknown (readSyncState failed) — NOT writing sync_state, to avoid rolling the cursor forward into a gap.'
        );
      } else {
        const failureCursor = nextSyncCursor('failed', previousCursor, new Date().toISOString());
        await updateSyncState(failureCursor, result.activeRecords + result.soldRecords, 'failed');
      }
    } catch (stateErr: any) {
      console.error('   ⚠️  Could not record failed sync_state:', describeError(stateErr));
    }

    return result;
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  if (args[0] === 'sync') {
    const result = await runDeltaSync();
    // Exit non-zero when the sync did not fully succeed, so CI marks the run failed and
    // the failure notifier in daily-sync.yml fires. runDeltaSync catches its OWN errors
    // and returns success:false (it never throws), so without this the process would
    // exit 0 and a real failure would show up GREEN — no alert. The sync_state cursor is
    // already preserved on failure inside runDeltaSync (CLAUDE.md §12), so exiting here
    // is purely about surfacing the failure.
    if (!result.success) {
      console.error(
        `\n❌ Sync finished with ${result.errors.length} error(s) — exiting 1 so the run is marked failed.`
      );
      process.exitCode = 1;
    }
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
  PROPTX_IDX_TOKEN   - TRREB IDX bearer token (Active listings, Query A)
  PROPTX_VOW_TOKEN   - TRREB VOW bearer token (Sold listings, Query B)
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