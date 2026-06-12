/**
 * Shadow MLS - Temporal Distress Engine (Phase 4)
 *
 * Provides property-hash generation (entity resolution) and timestamp parsing
 * that underpin the campaign-history ledger and True DOM calculations.
 *
 * NOTE: `calculateTrueDOM`, `generateLooseKey`, `resolveHistoricalCandidates`,
 * and `generatePropertyHashBatch` were removed in the 2026-06-11 dead-code sweep
 * (audit HIGH-10). The campaign-history ledger (`src/lib/campaignHistory/`) replaced
 * them in PR #17. `unitsMatchForMerge` is retained — it is still imported by
 * `src/lib/campaignHistory/fetch.ts`.
 */

import { createHash } from 'crypto';

// ============================================================================
// Constants
// ============================================================================

/**
 * Stitching window in days — the maximum gap between one campaign ending
 * (cancellation/close) and the next relisting for the two to count as ONE
 * continuous campaign. This is the rule that defeats the realtor
 * cancel-and-relist tactic. Default 35 (mid of the 30–40 day range we
 * want to catch); tunable per call via computeTrueDomFromCampaigns options.
 */
export const STITCH_WINDOW_DAYS = 35;

/**
 * @deprecated Use STITCH_WINDOW_DAYS. Retained as an alias so existing imports
 * keep working; both now resolve to the same window.
 */
export const COOLING_OFF_DAYS = STITCH_WINDOW_DAYS;

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
    [key: string]: unknown;
  };
  derived_metrics?: {
    calculatedDOM?: number;
  };
  created_at: string;
}

// ============================================================================
// Entity Resolution - Property Hash Generation
// ============================================================================

/**
 * Normalizes a string for hashing by:
 * - Converting to lowercase
 * - Stripping all whitespace
 * - Removing punctuation (#, -, ., apt, unit, etc.)
 */
function normalizeAddressComponent(input: unknown): string {
  if (input === null || input === undefined) return '';

  const str = String(input).trim().toLowerCase();

  return str
    .replace(/[#\-_.]/g, '')
    .replace(/\bapt\b/gi, '')
    .replace(/\bunit\b/gi, '')
    .replace(/\bsuite\b/gi, '')
    .replace(/\blot\b/gi, '')
    .replace(/\bblock\b/gi, '')
    .replace(/\bplan\b/gi, '')
    .replace(/\d+/g, (match) => match)
    .replace(/\s+/g, '')
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
 */
export function generatePropertyHash(listing: Record<string, unknown>): string {
  const unitNumber = normalizeAddressComponent(listing.UnitNumber);
  const streetNumber = normalizeAddressComponent(listing.StreetNumber);
  const streetName = normalizeAddressComponent(listing.StreetName);
  const city = normalizeAddressComponent(listing.City);

  let unparsedNormalized = '';
  if (!streetNumber || !streetName) {
    const unparsed = normalizeAddressComponent(listing.UnparsedAddress);
    if (unparsed) {
      unparsedNormalized = unparsed;
    }
  }

  let canonical: string;
  if (unparsedNormalized) {
    canonical = `${city}|${unparsedNormalized}`;
  } else {
    canonical = `${unitNumber}|${streetNumber}|${streetName}|${city}`;
  }

  const hash = createHash('sha256').update(canonical).digest('hex');
  return hash;
}

// ============================================================================
// Unit Compatibility (used by src/lib/campaignHistory/fetch.ts)
// ============================================================================

/** Condo/apartment/co-op detection from PropertySubType (deterministic). */
function isCondoSubType(subType: unknown): boolean {
  const s = String(subType ?? '').toLowerCase();
  return s.includes('condo') || s.includes('apartment') || s.includes('co-op') || s.includes('co op');
}

/**
 * Whether two listings' units are compatible for merging into one chain.
 * - Condo/apartment OR a unit present on either side → require EXACT normalized
 *   UnitNumber (distinct units NEVER merge).
 * - Freehold with no unit on either side → the loose key alone suffices.
 */
export function unitsMatchForMerge(
  a: { UnitNumber?: unknown; PropertySubType?: unknown },
  b: { UnitNumber?: unknown; PropertySubType?: unknown }
): boolean {
  const aUnit = normalizeAddressComponent(a.UnitNumber);
  const bUnit = normalizeAddressComponent(b.UnitNumber);
  if (isCondoSubType(a.PropertySubType) || isCondoSubType(b.PropertySubType) || aUnit || bUnit) {
    return aUnit !== '' && aUnit === bUnit;
  }
  return true;
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
    if (/^\d+$/.test(str)) {
      const num = parseInt(str, 10);
      const ms = num > 1e12 ? num : num * 1000;
      const date = new Date(ms);
      return isNaN(date.getTime()) ? null : ms;
    }

    const date = new Date(str);
    return isNaN(date.getTime()) ? null : date.getTime();
  } catch {
    return null;
  }
}

export default {
  generatePropertyHash,
  parseTimestamp,
  unitsMatchForMerge,
  STITCH_WINDOW_DAYS,
  COOLING_OFF_DAYS,
  STALE_THRESHOLD_DAYS,
};
