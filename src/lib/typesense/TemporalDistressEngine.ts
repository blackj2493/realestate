/**
 * Shadow MLS - Temporal Distress Engine (Phase 4)
 * 
 * Entity Resolution module that calculates "True DOM" (Shadow DOM) by stitching
 * historical listing chains. Bypasses realtor relisting manipulation that inflates
 * the raw DaysOnMarket metric.
 * 
 * Key Concepts:
 * - property_hash: Deterministic identifier linking listings for the same physical property
 * - True DOM: The real cumulative days a property has been on market (including relists)
 * - 45-day cooling-off threshold: Listings relisted within 45 days are the same campaign
 * 
 * Run: npx tsx scripts/worker/temporal-test.ts
 */

import { createHash } from 'crypto';

// ============================================================================
// Constants
// ============================================================================

/**
 * Cooling-off threshold in days.
 * Listings relisted within this window are considered the same campaign.
 */
export const COOLING_OFF_DAYS = 45;

/**
 * Staleness threshold in days.
 * Properties with True DOM exceeding this are flagged as stale.
 */
export const STALE_THRESHOLD_DAYS = 60;

// ============================================================================
// Types
// ============================================================================

/**
 * Output interface for temporal distress metrics.
 * These fields are indexed in Typesense for investor filtering.
 */
export interface TemporalMetrics {
  /** Deterministic hash of the property address */
  property_hash: string;
  
  /** True Days on Market (Shadow DOM) - cumulative active days including relists */
  true_dom: number;
  
  /** $ delta between original list price of FIRST listing in chain and current */
  total_price_drop: number;
  
  /** true if true_dom > 60 (stale inventory indicator) */
  is_stale: boolean;
}

/**
 * Historical listing record from Supabase.
 * Includes calculated DOM and price history.
 */
export interface HistoricalListing {
  listing_key: string;
  property_hash: string;
  full_payload: {
    ListPrice?: number;
    OriginalEntryTimestamp?: string;
    CancellationDate?: string;
    ModificationTimestamp?: string;
    SystemModificationTimestamp?: string;
    // ... other fields from ProptX API
    [key: string]: unknown;
  };
  derived_metrics?: {
    calculatedDOM?: number;
  };
  created_at: string;
}

/**
 * Input type for a current listing being processed.
 */
export interface CurrentListingInput {
  listingKey: string;
  propertyHash: string;
  listPrice: number;
  originalEntryTimestamp: string | null;
  cancellationDate?: string | null;
  modificationTimestamp?: string | null;
}

// ============================================================================
// Entity Resolution - Property Hash Generation
// ============================================================================

/**
 * Normalizes a string for hashing by:
 * - Converting to lowercase
 * - Stripping all whitespace
 * - Removing punctuation (#, -, ., apt, unit, etc.)
 * 
 * @param input - Raw address component
 * @returns Normalized lowercase string
 */
function normalizeAddressComponent(input: unknown): string {
  if (input === null || input === undefined) return '';
  
  const str = String(input).trim().toLowerCase();
  
  // Remove common punctuation and prefixes/suffixes
  return str
    .replace(/[#\-_.]/g, '')  // Remove #, -, _, .
    .replace(/\bapt\b/gi, '') // Remove "apt"
    .replace(/\bunit\b/gi, '') // Remove "unit"
    .replace(/\bsuite\b/gi, '') // Remove "suite"
    .replace(/\blot\b/gi, '') // Remove "lot"
    .replace(/\bblock\b/gi, '') // Remove "block"
    .replace(/\bplan\b/gi, '') // Remove "plan"
    .replace(/\d+/g, (match) => match) // Keep numbers
    .replace(/\s+/g, '') // Collapse whitespace
    .trim();
}

/**
 * Generates a deterministic SHA-256 hash for a property based on its address.
 * This hash is used to link historical listings for the same physical property.
 * 
 * Input fields (from ProptX API):
 * - UnitNumber (optional): Apartment/condo unit
 * - StreetNumber: Street address number
 * - StreetName: Street name (excluding type like "St", "Ave")
 * - City: City/municipality
 * 
 * @param listing - Raw listing payload from ProptX API
 * @returns SHA-256 hash string (64 characters)
 * 
 * @example
 * ```typescript
 * const hash = generatePropertyHash({
 *   UnitNumber: '1605',
 *   StreetNumber: '12',
 *   StreetName: 'King Street West',
 *   City: 'Toronto'
 * });
 * // Returns: 'a1b2c3d4e5f6...' (64 char hex)
 * ```
 */
export function generatePropertyHash(listing: Record<string, unknown>): string {
  // Extract address components
  const unitNumber = normalizeAddressComponent(listing.UnitNumber);
  const streetNumber = normalizeAddressComponent(listing.StreetNumber);
  const streetName = normalizeAddressComponent(listing.StreetName);
  const city = normalizeAddressComponent(listing.City);
  
  // Fallback: try UnparsedAddress if individual components missing
  let unparsedNormalized = '';
  if (!streetNumber || !streetName) {
    const unparsed = normalizeAddressComponent(listing.UnparsedAddress);
    if (unparsed) {
      unparsedNormalized = unparsed;
    }
  }
  
  // Build canonical string (order matters for determinism)
  let canonical: string;
  if (unparsedNormalized) {
    // Use unparsed address when individual components unavailable
    canonical = `${city}|${unparsedNormalized}`;
  } else {
    // Standard: unit|number|street|city
    canonical = `${unitNumber}|${streetNumber}|${streetName}|${city}`;
  }
  
  // Generate SHA-256 hash
  const hash = createHash('sha256').update(canonical).digest('hex');
  
  return hash;
}

/**
 * Batch generates property hashes for multiple listings.
 * Useful for pre-computing hashes before Supabase lookup.
 * 
 * @param listings - Array of raw listing payloads
 * @returns Map of listingKey -> property_hash
 */
export function generatePropertyHashBatch(
  listings: Array<{ listingKey?: string | null; [key: string]: unknown }>
): Map<string, string> {
  const results = new Map<string, string>();
  
  for (const listing of listings) {
    const key = listing.listingKey || 'unknown';
    const hash = generatePropertyHash(listing);
    results.set(key, hash);
  }
  
  return results;
}

// ============================================================================
// Date Parsing Utilities
// ============================================================================

/**
 * Safely parses a timestamp into milliseconds since epoch.
 * Handles ISO strings, Unix epochs, and messy board data.
 * 
 * @param timestamp - ISO string or Unix epoch (seconds or milliseconds)
 * @returns Unix timestamp in milliseconds, or null if invalid
 */
export function parseTimestamp(timestamp: unknown): number | null {
  if (timestamp === null || timestamp === undefined) return null;
  
  const str = String(timestamp).trim();
  if (!str) return null;
  
  try {
    // Check if it's a numeric Unix timestamp
    // Distinguish between seconds (10 digits) and milliseconds (13 digits)
    if (/^\d+$/.test(str)) {
      const num = parseInt(str, 10);
      // If 10 digits, assume seconds; if 13, assume milliseconds
      const ms = num > 1e12 ? num : num * 1000;
      const date = new Date(ms);
      return isNaN(date.getTime()) ? null : ms;
    }
    
    // Parse ISO 8601 string
    const date = new Date(str);
    return isNaN(date.getTime()) ? null : date.getTime();
  } catch {
    return null;
  }
}

/**
 * Calculates the number of days between two timestamps.
 * 
 * @param startMs - Start timestamp in milliseconds
 * @param endMs - End timestamp in milliseconds (defaults to now)
 * @returns Number of days (floored), or null if inputs invalid
 */
export function daysBetween(startMs: number | null, endMs?: number): number | null {
  if (startMs === null) return null;
  
  const end = endMs !== undefined ? endMs : Date.now();
  const diffMs = end - startMs;
  
  // Divide by milliseconds per day (86,400,000)
  const days = Math.floor(diffMs / 86400000);
  
  return isNaN(days) ? null : days;
}

// ============================================================================
// True DOM Calculation (Stitching Algorithm)
// ============================================================================

/**
 * Calculates active days for a single listing.
 * Uses OriginalEntryTimestamp as the listing start date.
 * 
 * @param listing - Listing with timestamps
 * @param endDate - End date in milliseconds (defaults to now)
 * @returns Number of days the listing was active
 */
export function calculateListingActiveDays(
  listing: { originalEntryTimestamp?: string | null; modificationTimestamp?: string | null },
  endDateMs?: number
): number {
  const startMs = parseTimestamp(listing.originalEntryTimestamp);
  if (startMs === null) return 0;
  
  return daysBetween(startMs, endDateMs) ?? 0;
}

/**
 * Retrieves the "end date" of a historical listing.
 * Priority: CancellationDate > ModificationTimestamp > SystemModificationTimestamp
 * 
 * @param historicalListing - Historical listing record from Supabase
 * @returns End date in milliseconds, or null if unavailable
 */
function getListingEndDate(historicalListing: HistoricalListing): number | null {
  const payload = historicalListing.full_payload || {};
  
  // Try CancellationDate first (most accurate for relisting)
  let endDate = parseTimestamp(payload.CancellationDate);
  if (endDate !== null) return endDate;
  
  // Fallback to ModificationTimestamp
  endDate = parseTimestamp(payload.ModificationTimestamp);
  if (endDate !== null) return endDate;
  
  // Last resort: SystemModificationTimestamp
  endDate = parseTimestamp(payload.SystemModificationTimestamp);
  if (endDate !== null) return endDate;
  
  return null;
}

/**
 * Calculates the True DOM by stitching together contiguous listing campaigns.
 * 
 * Algorithm:
 * 1. Sort historical listings by OriginalEntryTimestamp descending (newest first)
 * 2. Start with current listing's active days as true_dom
 * 3. For each historical listing:
 *    a. Calculate gap between current campaign start and historical end date
 *    b. IF gap <= 45 days: Stitch! Add historical active days to true_dom
 *    c. IF gap > 45 days: Break - genuine off-market period, chain broken
 * 4. Calculate total_price_drop from first listing's original price to current price
 * 
 * @param currentListing - The current/active listing being indexed
 * @param historicalListings - Previous listings for the same property_hash (excluding current)
 * @param options - Configuration options
 * @returns TemporalMetrics with true_dom, total_price_drop, is_stale
 * 
 * @example
 * ```typescript
 * const metrics = calculateTrueDOM(currentListing, historicalListings);
 * // metrics.true_dom = 145 (includes 90 days from relisted campaign)
 * // metrics.total_price_drop = 50000
 * // metrics.is_stale = true
 * ```
 */
export function calculateTrueDOM(
  currentListing: CurrentListingInput,
  historicalListings: HistoricalListing[],
  options: { coolingOffDays?: number; staleThresholdDays?: number } = {}
): TemporalMetrics {
  const coolingOffDays = options.coolingOffDays ?? COOLING_OFF_DAYS;
  const staleThresholdDays = options.staleThresholdDays ?? STALE_THRESHOLD_DAYS;
  
  // Handle empty historical list
  if (!historicalListings || historicalListings.length === 0) {
    const currentDays = calculateListingActiveDays({
      originalEntryTimestamp: currentListing.originalEntryTimestamp
    });
    
    return {
      property_hash: currentListing.propertyHash,
      true_dom: currentDays,
      total_price_drop: 0,
      is_stale: currentDays > staleThresholdDays
    };
  }
  
  // Sort historical listings by OriginalEntryTimestamp descending (newest first)
  const sortedHistory = [...historicalListings].sort((a, b) => {
    const aMs = parseTimestamp(a.full_payload?.OriginalEntryTimestamp) ?? 0;
    const bMs = parseTimestamp(b.full_payload?.OriginalEntryTimestamp) ?? 0;
    return bMs - aMs; // Descending (newest first)
  });
  
  // Start with current listing's active days
  const currentStartMs = parseTimestamp(currentListing.originalEntryTimestamp);
  const currentDays = currentStartMs !== null 
    ? daysBetween(currentStartMs) ?? 0 
    : 0;
  
  let trueDom = currentDays;
  let currentCampaignStartMs = currentStartMs;
  
  // Store the first (oldest) original price for price drop calculation
  let firstOriginalPrice: number | null = null;
  
  // Track cumulative price from original to current
  let originalPriceInChain: number | null = null;
  
  // Process the chain
  for (const historical of sortedHistory) {
    const historicalPayload = historical.full_payload || {};
    
    // Get historical listing's start and end dates
    const historicalStartMs = parseTimestamp(historicalPayload.OriginalEntryTimestamp);
    if (historicalStartMs === null) continue;
    
    const historicalEndMs = getListingEndDate(historical);
    
    // Calculate gap between current campaign start and historical end date
    // If no end date, use current time (listing still active when historical was fetched)
    const gapEndMs = historicalEndMs ?? Date.now();
    
    // Gap = current_campaign_start - historical_end
    // If gap is positive and <= cooling off period, they're the same campaign
    if (currentCampaignStartMs !== null && gapEndMs !== null) {
      const gapDays = Math.floor((currentCampaignStartMs - gapEndMs) / 86400000);
      
      // Check if gap exceeds cooling-off period
      if (gapDays > coolingOffDays) {
        // Chain broken - genuine off-market period
        break;
      }
      
      // Stitch! Add historical active days to true_dom
      const historicalDays = Math.floor((gapEndMs - historicalStartMs) / 86400000);
      if (historicalDays > 0) {
        trueDom += historicalDays;
      }
      
      // Update campaign start to this historical listing's start
      currentCampaignStartMs = historicalStartMs;
      
      // Track the first price in the chain (oldest listing)
      if (originalPriceInChain === null && historicalPayload.ListPrice) {
        originalPriceInChain = historicalPayload.ListPrice;
      }
    }
  }
  
  // Calculate total price drop
  let totalPriceDrop = 0;
  
  if (originalPriceInChain !== null && originalPriceInChain > 0) {
    // Compare the first price in chain to current price
    totalPriceDrop = originalPriceInChain - currentListing.listPrice;
  } else if (currentListing.listPrice > 0) {
    // No historical price found - no price drop to calculate
    // (property was never relisted, so original = current)
    totalPriceDrop = 0;
  }
  
  // Determine staleness
  const isStale = trueDom > staleThresholdDays;
  
  return {
    property_hash: currentListing.propertyHash,
    true_dom: trueDom,
    total_price_drop: Math.max(0, totalPriceDrop), // Never negative
    is_stale: isStale
  };
}

// ============================================================================
// Batch Processing Utilities
// ============================================================================

/**
 * Groups historical listings by property_hash for efficient lookup.
 * This enables the batch processing pattern (1 query, group locally).
 * 
 * @param historicalListings - Array of historical listings from Supabase
 * @returns Map of property_hash -> HistoricalListing[]
 */
export function groupHistoricalByHash(
  historicalListings: HistoricalListing[]
): Map<string, HistoricalListing[]> {
  const grouped = new Map<string, HistoricalListing[]>();
  
  for (const listing of historicalListings) {
    const hash = listing.property_hash;
    if (!hash) continue;
    
    const existing = grouped.get(hash);
    if (existing) {
      existing.push(listing);
    } else {
      grouped.set(hash, [listing]);
    }
  }
  
  return grouped;
}

/**
 * Processes a batch of current listings against their historical records.
 * Implements the efficient batch pattern:
 * 1. Generate hashes for all current listings
 * 2. Single Supabase query for all historical matches
 * 3. Group historical locally
 * 4. Compute true_dom in memory
 * 
 * @param currentListings - Batch of listings being processed
 * @param historicalListings - Historical records fetched by property_hash
 * @returns Array of TemporalMetrics (same order as currentListings)
 */
export function processTemporalBatch(
  currentListings: Array<{
    listingKey: string;
    listPrice: number;
    originalEntryTimestamp: string | null;
    propertyHash: string;
  }>,
  historicalListings: HistoricalListing[]
): TemporalMetrics[] {
  // Group historical listings by property_hash
  const groupedHistory = groupHistoricalByHash(historicalListings);
  
  // Process each current listing
  return currentListings.map(current => {
    const history = groupedHistory.get(current.propertyHash) || [];
    
    // Filter out the current listing from historical (if present)
    const filteredHistory = history.filter(h => h.listing_key !== current.listingKey);
    
    return calculateTrueDOM(
      {
        listingKey: current.listingKey,
        propertyHash: current.propertyHash,
        listPrice: current.listPrice,
        originalEntryTimestamp: current.originalEntryTimestamp
      },
      filteredHistory
    );
  });
}

// ============================================================================
// Test & Dev Helpers
// ============================================================================

/**
 * Creates a mock historical listing for testing.
 */
export function createMockHistoricalListing(
  overrides: Partial<HistoricalListing> = {}
): HistoricalListing {
  const daysAgo = Math.floor(Math.random() * 180) + 30;
  const startDate = new Date(Date.now() - daysAgo * 86400000);
  const endDate = new Date(Date.now() - (daysAgo - Math.floor(Math.random() * 60)) * 86400000);
  
  return {
    listing_key: `HIST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    property_hash: 'mock_hash_for_testing',
    full_payload: {
      ListPrice: 800000 + Math.floor(Math.random() * 200000),
      OriginalEntryTimestamp: startDate.toISOString(),
      CancellationDate: endDate.toISOString(),
    },
    derived_metrics: {
      calculatedDOM: Math.floor((endDate.getTime() - startDate.getTime()) / 86400000)
    },
    created_at: endDate.toISOString(),
    ...overrides
  };
}

/**
 * Runs comprehensive test cases for temporal metrics.
 */
export function runTemporalTests(): void {
  console.log('\n🧪 Shadow MLS Temporal Distress Engine Tests');
  console.log('='.repeat(60));
  
  // ── Test 1: Basic Property Hash Generation ──────────────────────────────
  console.log('\n🏠 Test 1: Property Hash Generation');
  
  const listing1 = {
    UnitNumber: '1605',
    StreetNumber: '12',
    StreetName: 'King Street West',
    City: 'Toronto'
  };
  const hash1 = generatePropertyHash(listing1);
  console.log('   Input:', JSON.stringify(listing1));
  console.log('   Hash:', hash1);
  console.assert(hash1.length === 64, 'Should be 64-char SHA-256 hex');
  
  // Same address should produce same hash (deterministic)
  const hash1Repeat = generatePropertyHash(listing1);
  console.assert(hash1 === hash1Repeat, 'Same address should produce same hash');
  
  // Case/punctuation insensitive
  const listing1Upper = {
    UnitNumber: '1605',
    StreetNumber: '12',
    StreetName: 'KING STREET WEST',
    City: 'TORONTO'
  };
  const hash1Upper = generatePropertyHash(listing1Upper);
  console.assert(hash1 === hash1Upper, 'Case insensitive normalization should produce same hash');
  
  // Different unit should produce different hash
  const listing2 = {
    UnitNumber: '1606', // Different unit
    StreetNumber: '12',
    StreetName: 'King Street West',
    City: 'Toronto'
  };
  const hash2 = generatePropertyHash(listing2);
  console.assert(hash1 !== hash2, 'Different unit should produce different hash');
  
  console.log('   ✅ Hash generation is deterministic and case/punctuation insensitive');
  
  // ── Test 2: Date Parsing ──────────────────────────────────────────────────
  console.log('\n📅 Test 2: Date Parsing');
  
  // ISO string
  const isoResult = parseTimestamp('2024-01-15T10:30:00Z');
  console.assert(isoResult !== null, 'Should parse ISO string');
  console.log('   ISO "2024-01-15T10:30:00Z":', isoResult);
  
  // Unix seconds
  const unixSecResult = parseTimestamp('1705315800');
  console.assert(unixSecResult !== null, 'Should parse Unix seconds');
  console.log('   Unix seconds "1705315800":', unixSecResult);
  
  // Unix milliseconds
  const unixMsResult = parseTimestamp('1705315800000');
  console.assert(unixMsResult !== null, 'Should parse Unix milliseconds');
  console.log('   Unix milliseconds "1705315800000":', unixMsResult);
  
  // Invalid
  const invalidResult = parseTimestamp('not-a-date');
  console.assert(invalidResult === null, 'Should return null for invalid');
  console.log('   Invalid "not-a-date":', invalidResult);
  
  console.log('   ✅ Date parsing handles ISO, Unix seconds, and Unix milliseconds');
  
  // ── Test 3: Single Listing (No History) ───────────────────────────────────
  console.log('\n📊 Test 3: Single Listing (No Historical Chain)');
  
  const currentListing: CurrentListingInput = {
    listingKey: 'MLS123456',
    propertyHash: 'test_hash',
    listPrice: 850000,
    originalEntryTimestamp: new Date(Date.now() - 30 * 86400000).toISOString()
  };
  
  const result3 = calculateTrueDOM(currentListing, []);
  console.log('   Current listing on market: 30 days');
  console.log('   Result:', JSON.stringify(result3));
  console.assert(result3.true_dom >= 29 && result3.true_dom <= 31, 'Should be ~30 days');
  console.assert(result3.total_price_drop === 0, 'No history = no price drop');
  console.assert(result3.is_stale === false, '30 days should not be stale');
  
  // ── Test 4: Stale Listing ───────────────────────────────────────────────────
  console.log('\n⏰ Test 4: Stale Listing (True DOM > 60 days)');
  
  const staleListing: CurrentListingInput = {
    listingKey: 'MLS789012',
    propertyHash: 'test_hash',
    listPrice: 780000,
    originalEntryTimestamp: new Date(Date.now() - 75 * 86400000).toISOString()
  };
  
  const result4 = calculateTrueDOM(staleListing, []);
  console.log('   Current listing on market: 75 days');
  console.log('   Result:', JSON.stringify(result4));
  console.assert(result4.true_dom >= 74 && result4.true_dom <= 76, 'Should be ~75 days');
  console.assert(result4.is_stale === true, '75 days should be stale');
  
  // ── Test 5: Relisted Property (45-day threshold) ───────────────────────────
  console.log('\n🔗 Test 5: Relisted Property (45-day cooling off)');
  
  // Current listing: 20 days ago
  const current20DaysAgo = new Date(Date.now() - 20 * 86400000).toISOString();
  const relistedListing: CurrentListingInput = {
    listingKey: 'MLS_RELISTED',
    propertyHash: 'relist_hash',
    listPrice: 820000, // Price dropped from 900k
    originalEntryTimestamp: current20DaysAgo
  };
  
  // Historical: 90 days ago, ended 50 days ago (within 45-day threshold)
  const historical90DaysAgo = new Date(Date.now() - 90 * 86400000);
  const historicalEnded50DaysAgo = new Date(Date.now() - 50 * 86400000);
  
  const historical: HistoricalListing[] = [{
    listing_key: 'MLS_OLD',
    property_hash: 'relist_hash',
    full_payload: {
      ListPrice: 900000,
      OriginalEntryTimestamp: historical90DaysAgo.toISOString(),
      CancellationDate: historicalEnded50DaysAgo.toISOString()
    },
    created_at: historicalEnded50DaysAgo.toISOString()
  }];
  
  const result5 = calculateTrueDOM(relistedListing, historical);
  console.log('   Historical: 90 days ago, ended 50 days ago');
  console.log('   Gap: 30 days (within 45-day threshold)');
  console.log('   Current: 20 days ago');
  console.log('   Result:', JSON.stringify(result5));
  console.assert(result5.true_dom > 20, 'Should include historical days');
  console.assert(result5.total_price_drop > 0, 'Should show price drop from 900k to 820k');
  console.log('   ✅ Relisted property correctly stitched');
  
  // ── Test 6: Chain Broken (> 45-day gap) ───────────────────────────────────
  console.log('\n⛓️  Test 6: Chain Broken (> 45-day gap)');
  
  // Current listing: 30 days ago
  const brokenCurrent: CurrentListingInput = {
    listingKey: 'MLS_BROKEN',
    propertyHash: 'broken_hash',
    listPrice: 750000,
    originalEntryTimestamp: new Date(Date.now() - 30 * 86400000).toISOString()
  };
  
  // Historical ended 60 days ago (gap > 45, chain broken)
  const brokenHistoricalEnd = new Date(Date.now() - 60 * 86400000);
  const brokenHistoricalStart = new Date(Date.now() - 120 * 86400000);
  
  const brokenHistory: HistoricalListing[] = [{
    listing_key: 'MLS_BROKEN_OLD',
    property_hash: 'broken_hash',
    full_payload: {
      ListPrice: 950000,
      OriginalEntryTimestamp: brokenHistoricalStart.toISOString(),
      CancellationDate: brokenHistoricalEnd.toISOString()
    },
    created_at: brokenHistoricalEnd.toISOString()
  }];
  
  const result6 = calculateTrueDOM(brokenCurrent, brokenHistory);
  console.log('   Historical: ended 60 days ago (gap > 45, chain broken)');
  console.log('   Current: 30 days ago');
  console.log('   Result:', JSON.stringify(result6));
  console.assert(result6.true_dom >= 29 && result6.true_dom <= 31, 'Should be ~30 days only (no stitch)');
  console.assert(result6.total_price_drop === 0, 'No stitched chain = no price drop calculated');
  
  // ── Test 7: Complex Chain (Multiple Relists) ──────────────────────────────
  console.log('\n🔗 Test 7: Complex Chain (Multiple Relists)');
  
  const complexCurrent: CurrentListingInput = {
    listingKey: 'MLS_COMPLEX',
    propertyHash: 'complex_hash',
    listPrice: 700000,
    originalEntryTimestamp: new Date(Date.now() - 10 * 86400000).toISOString()
  };
  
  // Build a chain: current -> 25 days ago (gap 5 days) -> 60 days ago (gap 10 days) -> 90 days ago
  const complexHistory: HistoricalListing[] = [
    {
      listing_key: 'MLS_COMPLEX_2',
      property_hash: 'complex_hash',
      full_payload: {
        ListPrice: 750000, // Second listing at 750k
        OriginalEntryTimestamp: new Date(Date.now() - 35 * 86400000).toISOString(),
        CancellationDate: new Date(Date.now() - 25 * 86400000).toISOString()
      },
      created_at: new Date(Date.now() - 25 * 86400000).toISOString()
    },
    {
      listing_key: 'MLS_COMPLEX_1',
      property_hash: 'complex_hash',
      full_payload: {
        ListPrice: 850000, // First listing at 850k (original price for chain)
        OriginalEntryTimestamp: new Date(Date.now() - 70 * 86400000).toISOString(),
        CancellationDate: new Date(Date.now() - 60 * 86400000).toISOString()
      },
      created_at: new Date(Date.now() - 60 * 86400000).toISOString()
    }
  ];
  
  const result7 = calculateTrueDOM(complexCurrent, complexHistory);
  console.log('   Chain: 10 days (current) + 25 days + 60 days = 95 total');
  console.log('   Price drop: 850k (original) - 700k (current) = 150k');
  console.log('   Result:', JSON.stringify(result7));
  console.assert(result7.true_dom >= 90, 'Should be ~95 days (with tolerance for timing)');
  console.assert(result7.total_price_drop === 150000, 'Should show 150k price drop');
  console.log('   ✅ Complex chain correctly stitched');
  
  // ── Test 8: Batch Processing ─────────────────────────────────────────────
  console.log('\n📦 Test 8: Batch Processing');
  
  const batch = [
    { listingKey: 'BATCH_1', listPrice: 800000, originalEntryTimestamp: new Date(Date.now() - 30 * 86400000).toISOString(), propertyHash: 'hash_a' },
    { listingKey: 'BATCH_2', listPrice: 900000, originalEntryTimestamp: new Date(Date.now() - 15 * 86400000).toISOString(), propertyHash: 'hash_b' },
    { listingKey: 'BATCH_3', listPrice: 750000, originalEntryTimestamp: new Date(Date.now() - 5 * 86400000).toISOString(), propertyHash: 'hash_c' },
  ];
  
  const batchHistory: HistoricalListing[] = [
    { listing_key: 'BATCH_1_OLD', property_hash: 'hash_a', full_payload: { ListPrice: 850000, OriginalEntryTimestamp: new Date(Date.now() - 60 * 86400000).toISOString() }, created_at: '' },
    { listing_key: 'BATCH_2_OLD', property_hash: 'hash_b', full_payload: { ListPrice: 950000, OriginalEntryTimestamp: new Date(Date.now() - 45 * 86400000).toISOString() }, created_at: '' },
  ];
  
  const batchResults = processTemporalBatch(batch, batchHistory);
  console.log('   Processed', batchResults.length, 'listings in batch');
  console.assert(batchResults.length === 3, 'Should process all 3 listings');
  console.log('   BATCH_1 price drop:', batchResults[0].total_price_drop);
  console.log('   BATCH_2 price drop:', batchResults[1].total_price_drop);
  console.log('   BATCH_3 price drop:', batchResults[2].total_price_drop);
  console.log('   ✅ Batch processing works correctly');
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ All temporal distress tests completed\n');
}

// Run if executed directly
if (require.main === module) {
  runTemporalTests();
}

export default {
  generatePropertyHash,
  calculateTrueDOM,
  processTemporalBatch,
  parseTimestamp,
  daysBetween,
  groupHistoricalByHash,
  runTemporalTests,
  COOLING_OFF_DAYS,
  STALE_THRESHOLD_DAYS
};