/**
 * Shadow MLS - ETL Transformer
 * 
 * Data mutation and derived metrics computation engine.
 * Transforms raw ProptX API payloads into:
 * - supabasePayload: Full JSONB document for storage
 * - typesensePayload: Lean index document for search
 * 
 * Run: npx tsx scripts/worker/transformer.ts
 */

import { createHash } from 'crypto';
import { getServiceRoleClient, ListingRecord } from '@/lib/supabase/client';
import { indexListing, deleteListing } from '@/lib/typesense/client';
import { loadPostalCodes, isDataLoaded } from '@/lib/postalCodes';
import { calculateProForma, ProFormaMetrics } from '@/lib/typesense/ExtrapolatedCapRateEngine';
import { calculateCanadianMonthlyMortgage } from '@/lib/finance/canadianMortgage';
import { detectDistress } from '@/lib/listings/distressSignals';
import { calculateMultiUnitPotential, MultiUnitStatus } from './services/multiUnitCalculator';
import { calculateSurplusParking } from './services/parkingCalculator';
import { fetchRentAVM, type RentAVMResult } from './services/rentAVM';
import { resolveRatioPrice, fetchMillRate } from './services/ratioPriceCalculator';
import { calculateFinancialMetrics } from './services/financialMetrics';
import { processBuilderMetrics } from '@/services/BuilderAnalyticsEngine';
import { resolveLocation } from './resolveLocation';
import { assignSchools } from '@/lib/schools/nearestSchools';
import { assignAmenities } from '@/lib/amenities/nearestAmenities';
import { selectPrimaryImage, collectMediaUrls } from '@/lib/etl/selectPrimaryImage';
import { deriveBasementTier } from '@/lib/avm/conditionScoring';
import { normalizeDirectionFaces } from '@/lib/listings/directionFaces';
import { sqftBoundsFor } from '@/lib/listings/livingAreaBands';

// ============================================================================
// Configuration
// ============================================================================

const BASELINE_RENT = 1200;  // Monthly rent placeholder per bedroom

/**
 * Drop the `media` array before a listing record is persisted to
 * listings.full_payload (migration 103).
 *
 * Returns a shallow copy — the caller's `raw` keeps its media, because sync.ts still
 * builds the Typesense doc from it and mediaUrls/primaryThumbnailUrl are derived from
 * it here. Only what lands in Postgres is slimmed; media_urls carries the photos.
 */
function stripStoredMedia(raw: Record<string, unknown>): Record<string, unknown> {
  if (!('media' in raw)) return raw;
  const out = { ...raw };
  delete out.media;
  return out;
}

/** Coerce a raw RESO scalar to a finite number, else 0 — used for the flat dimension
 *  columns (migration 045). 0 = missing, matching the Typesense extraction so a stored
 *  row is never NULL and the region RPC's full_payload fallback only fires pre-backfill. */
function numOr0(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Initialize postal codes on module load
if (!isDataLoaded()) {
  loadPostalCodes();
}

// ============================================================================
// Macros (May 2026 Canadian Investor Market)
// ============================================================================

const DOWN_PAYMENT_PCT = 0.20;           // 20% down payment
const INVESTOR_RATE = 0.0404;            // 4.04% 5-year fixed
const AMORTIZATION_MONTHS = 360;          // 30-year (360 months)

// Municipal Mill Rates (annual mill rate per dollar of assessed value)
const MILL_RATES: Record<string, number> = {
  'Toronto': 0.007,
  'Brampton': 0.010,
  'Mississauga': 0.009,
  'Oakville': 0.008,
  'Burlington': 0.008,
  'Hamilton': 0.009,
  'London': 0.009,
  'Kitchener': 0.009,
  'Waterloo': 0.009,
  'Cambridge': 0.009,
  'Guelph': 0.008,
  'Ottawa': 0.008,
  'Barrie': 0.009,
  'Markham': 0.008,
  'Richmond Hill': 0.008,
  'Vaughan': 0.008,
  'Newmarket': 0.009,
  'Whitby': 0.009,
  'Oshawa': 0.010,
  'Ajax': 0.010,
  'Pickering': 0.010,
  'Default': 0.009  // Fallback mill rate
};

// ============================================================================
// Geospatial Resolution
// ============================================================================
// resolveLocation is shared with the vault reindexer (./resolveLocation) so the
// [lat, lng] coordinate order can never drift between the two writers. Re-export
// it here to preserve transformer.ts's public API.
export { resolveLocation };

// ============================================================================
// 1. TRUE CARRY COST ENGINE
// ============================================================================

/**
 * Canadian mortgage calculation — delegates to the canonical helper in
 * @/lib/finance/canadianMortgage which uses the correct effective monthly
 * rate `(1 + annualRate/2)^(1/6) − 1` per the Interest Act of Canada s.6.
 * Signature kept for backwards compatibility with existing callers + tests.
 */
export function calculateCanadianMortgage(
  principal: number,
  annualRate: number,
  amortizationMonths: number
): number {
  return calculateCanadianMonthlyMortgage(principal, annualRate, amortizationMonths);
}

/**
 * Carry Cost Breakdown Interface
 */
export interface CarryCostBreakdown {
  monthlyMortgage: number;
  monthlyPropertyTax: number;
  monthlyHOA: number;
  monthlyInsurance: number;
  monthlyUtilities: number;
  monthlyCapEx: number;
  trueCarryCost: number;
}

/**
 * Calculate the true carry cost for an investment property.
 * 
 * Components:
 * - Monthly Mortgage (Canadian semi-annual compounding)
 * - Monthly Property Tax (mill rate or actual)
 * - Monthly HOA/Maintenance
 * - Monthly Insurance
 * - Monthly Utilities (tenant-pays scenario)
 * - CapEx Reserve (1% rule)
 */
export function calculateCarryCost(raw: any): CarryCostBreakdown {
  const listPrice = raw.ListPrice || 0;
  const city = raw.City || '';
  const propertySubType = raw.PropertySubType || '';
  const propertyType = raw.PropertyType || '';
  
  // Determine property category
  const isCondo = propertySubType === 'Condo' || 
                  propertySubType === 'Condo Townhouse' ||
                  propertySubType === ' Apartment';
  const isFreehold = !isCondo && (
    propertySubType === 'Detached' ||
    propertySubType === 'Semi-Detached' ||
    propertySubType === 'Link' ||
    propertySubType === 'Freehold'
  );
  const isMultiFamily = propertySubType === 'Multiplex' || 
                        propertySubType === 'Duplex' ||
                        propertyType === 'Multi-Family';
  
  // ── 1. Monthly Mortgage ──────────────────────────────────────────────────
  const loanAmount = listPrice * (1 - DOWN_PAYMENT_PCT);
  const monthlyMortgage = calculateCanadianMortgage(loanAmount, INVESTOR_RATE, AMORTIZATION_MONTHS);
  
  // ── 2. Monthly Property Tax ─────────────────────────────────────────────
  let monthlyPropertyTax: number;
  if (raw.TaxAnnualAmount && raw.TaxAnnualAmount > 0) {
    monthlyPropertyTax = raw.TaxAnnualAmount / 12;
  } else {
    // Use municipal mill rate
    const millRate = MILL_RATES[city] || MILL_RATES['Default'];
    monthlyPropertyTax = (listPrice * millRate) / 12;
  }
  
  // ── 3. Monthly HOA/Maintenance ───────────────────────────────────────────
  let monthlyHOA: number;
  if (isCondo) {
    if (raw.AssociationFee && raw.AssociationFee > 0) {
      monthlyHOA = raw.AssociationFee;
    } else {
      // Estimate condo fees if null: $150-300/month
      monthlyHOA = 225;  // Middle estimate
    }
  } else {
    // Freehold: no HOA
    monthlyHOA = 0;
  }
  
  // ── 4. Monthly Insurance ─────────────────────────────────────────────────
  let monthlyInsurance: number;
  if (isCondo) {
    // Condo: building insured by corp, tenant contents only
    monthlyInsurance = 40;
  } else if (isFreehold) {
    monthlyInsurance = 135;  // $120-150/month estimate
  } else {
    // Multi-family: higher coverage needed
    monthlyInsurance = 200;
  }
  
  // ── 5. Monthly Utilities ─────────────────────────────────────────────────
  let monthlyUtilities: number;
  if (isMultiFamily) {
    // Multi-family (inclusive): landlord pays some utilities
    monthlyUtilities = 350;
  } else {
    // Detached/Condo: tenant pays utilities
    monthlyUtilities = 0;
  }
  
  // ── 6. CapEx Reserve (1% rule) ───────────────────────────────────────────
  // Freehold: 1% of list price annually
  // Condo: 0.5% (less exterior maintenance)
  let annualCapExRate = isCondo ? 0.005 : 0.01;
  
  // Reduce by 20% if age < 5 years
  if (raw.ApproximateAge) {
    const ageMatch = String(raw.ApproximateAge).match(/(\d+)/);
    if (ageMatch) {
      const age = parseInt(ageMatch[1], 10);
      if (age < 5) {
        annualCapExRate *= 0.8;
      }
    }
  }
  
  const monthlyCapEx = (listPrice * annualCapExRate) / 12;
  
  // ── True Carry Cost ─────────────────────────────────────────────────────
  const trueCarryCost = monthlyMortgage + monthlyPropertyTax + monthlyHOA + 
                        monthlyInsurance + monthlyUtilities + monthlyCapEx;
  
  return {
    monthlyMortgage: Math.round(monthlyMortgage * 100) / 100,
    monthlyPropertyTax: Math.round(monthlyPropertyTax * 100) / 100,
    monthlyHOA: Math.round(monthlyHOA * 100) / 100,
    monthlyInsurance: Math.round(monthlyInsurance * 100) / 100,
    monthlyUtilities: Math.round(monthlyUtilities * 100) / 100,
    monthlyCapEx: Math.round(monthlyCapEx * 100) / 100,
    trueCarryCost: Math.round(trueCarryCost * 100) / 100
  };
}

// ============================================================================
// 2. TRUE DAYS ON MARKET (TRUEDOM) ENGINE
// ============================================================================

/**
 * SHA-256 hash of normalized address for entity resolution.
 */
export function hashPropertyAddress(raw: any): string {
  // Normalize address components
  const streetNumber = (raw.StreetNumber || '').toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const streetName = (raw.StreetName || '').toString()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard)$/i, '');
  const unitNumber = (raw.UnitNumber || '').toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const postalCode = (raw.PostalCode || '').toString()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .substring(0, 6);
  const city = (raw.City || '').toString().replace(/[^a-zA-Z]/g, '').toLowerCase();
  
  // Concatenate for hashing
  const normalized = `${streetNumber}|${streetName}|${unitNumber}|${postalCode}|${city}`;
  
  return createHash('sha256').update(normalized).digest('hex');
}

interface TrueDOMResult {
  propertyHash: string;
  trueDOM: number;
  isStale: boolean;
  campaignBlockId: string;
  deadDays: number;  // Days before listing went dead
}

/**
 * @deprecated DO NOT CALL. Superseded by the pure-function
 * `calculateTrueDOM` in `src/lib/typesense/TemporalDistressEngine.ts`, which
 * sync.ts uses with a batched, full_payload-free historical lookup.
 *
 * This version issues a per-listing query that SELECTs `full_payload` —
 * exactly the IO-amplification pattern that tripped the Disk IO Budget
 * alert on 2026-05-19. Kept here only because other modules may still
 * import the symbol; will be deleted in a follow-up cleanup once verified.
 */
export async function calculateTrueDOM(
  raw: any,
  supabaseClient?: ReturnType<typeof getServiceRoleClient>
): Promise<TrueDOMResult> {
  const propertyHash = hashPropertyAddress(raw);
  const listingKey = raw.ListingKey || '';
  const entryTimestamp = raw.OriginalEntryTimestamp 
    ? new Date(raw.OriginalEntryTimestamp).getTime() 
    : Date.now();
  
  // Default result for new properties
  const defaultResult: TrueDOMResult = {
    propertyHash,
    trueDOM: 0,
    isStale: false,
    campaignBlockId: listingKey,
    deadDays: 0
  };
  
  // If no Supabase client, return basic hash-based calculation
  if (!supabaseClient) {
    const now = Date.now();
    const daysOnMarket = Math.floor((now - entryTimestamp) / (1000 * 60 * 60 * 24));
    return {
      ...defaultResult,
      trueDOM: daysOnMarket,
      isStale: daysOnMarket > 90
    };
  }
  
  try {
    // Query for previous listings with same property hash
    const { data: previousListings, error } = await supabaseClient
      .from('listings')
      .select('listing_key, full_payload, property_hash, created_at')
      .eq('property_hash', propertyHash)
      .neq('listing_key', listingKey)
      .order('created_at', { ascending: true });
    
    if (error) {
      console.warn(`[Transformer] TrueDOM query failed: ${error.message}`);
      const now = Date.now();
      const daysOnMarket = Math.floor((now - entryTimestamp) / (1000 * 60 * 60 * 24));
      return {
        ...defaultResult,
        trueDOM: daysOnMarket,
        isStale: daysOnMarket > 90
      };
    }
    
    if (!previousListings || previousListings.length === 0) {
      // No history - new campaign
      const now = Date.now();
      const daysOnMarket = Math.floor((now - entryTimestamp) / (1000 * 60 * 60 * 24));
      return {
        ...defaultResult,
        trueDOM: daysOnMarket,
        isStale: daysOnMarket > 90
      };
    }
    
    // Find earliest entry timestamp in campaign block
    let earliestTimestamp = entryTimestamp;
    let campaignBlockId = listingKey;
    
    for (const prev of previousListings) {
      const prevEntry = prev.full_payload?.OriginalEntryTimestamp 
        ? new Date(prev.full_payload.OriginalEntryTimestamp).getTime()
        : new Date(prev.created_at).getTime();
      
      // Calculate gap between previous and current
      const gap = entryTimestamp - prevEntry;
      const gapDays = gap / (1000 * 60 * 60 * 24);
      
      if (gapDays <= 45) {
        // Same campaign - extend block
        if (prevEntry < earliestTimestamp) {
          earliestTimestamp = prevEntry;
          campaignBlockId = prev.listing_key;
        }
      } else if (gapDays > 90) {
        // Gap > 90 days = new campaign, reset
        earliestTimestamp = entryTimestamp;
        campaignBlockId = listingKey;
      }
    }
    
    // Calculate trueDOM: currentDate - earliestTimestamp
    const now = Date.now();
    const trueDOM = Math.max(0, Math.floor((now - earliestTimestamp) / (1000 * 60 * 60 * 24)));
    
    // Calculate dead days (days DOM exceeded reasonable listing period)
    // Dead days = max(0, DOM - 30) for normal listings, or DOM - 60 for stale
    const deadDays = Math.max(0, trueDOM - 30);
    
    return {
      propertyHash,
      trueDOM,
      isStale: trueDOM > 90,
      campaignBlockId,
      deadDays
    };
    
  } catch (err: any) {
    console.warn(`[Transformer] TrueDOM calculation error: ${err.message}`);
    const now = Date.now();
    const daysOnMarket = Math.floor((now - entryTimestamp) / (1000 * 60 * 60 * 24));
    return {
      ...defaultResult,
      trueDOM: daysOnMarket,
      isStale: daysOnMarket > 90
    };
  }
}

// ============================================================================
// 3. SECONDARY SUITE STATUS ENGINE
// ============================================================================

type SuiteStatus = 'NONE' | 'POTENTIAL_CANDIDATE' | 'EXISTING_SUITE';

interface SuiteAnalysis {
  suiteStatus: SuiteStatus;
  suiteScore: number;  // 0-6 points
  flags: string[];
}

/**
 * Analyze secondary suite potential using scoring system.
 * 
 * Kill switch: Condo, CondoCorpNumber exists, Condo Townhouse → NONE
 * 
 * Existing Suite (auto-pass):
 * - KitchensBelowGrade > 0 → EXISTING_SUITE
 * - PropertySubType is "Multiplex" or "Duplex" → EXISTING_SUITE
 * - PublicRemarks matches: /(currently rented|tenant|existing.*suite)/i → EXISTING_SUITE
 * 
 * Scoring (need 3+ to be POTENTIAL_CANDIDATE):
 * +1: Basement has "Full" (not "Crawl Space")
 * +2: PublicRemarks matches /(separate.*entrance|walk-out|walkup)/i
 * +1: Basement bathroom (WashroomsTypeXLevel = "Basement" or "Lower") OR rough-in regex
 * +1: RoomsBelowGrade >= 2
 * +1: ParkingTotal >= 2
 * -2: ParkingTotal < 2 (fatal flaw)
 */
export function analyzeSuitePotential(raw: any): SuiteAnalysis {
  const propertySubType = raw.PropertySubType || '';
  const condoCorpNumber = raw.CondoCorpNumber;
  
  // ── Kill Switch ─────────────────────────────────────────────────────────
  if (
    propertySubType === 'Condo' ||
    propertySubType === 'Condo Townhouse' ||
    condoCorpNumber
  ) {
    return {
      suiteStatus: 'NONE',
      suiteScore: 0,
      flags: ['Kill switch: Condo property or CondoCorpNumber exists']
    };
  }
  
  const flags: string[] = [];
  let score = 0;
  
  // ── Existing Suite Detection (Auto-Pass) ───────────────────────────────
  // KitchensBelowGrade > 0
  if (raw.KitchensBelowGrade && raw.KitchensBelowGrade > 0) {
    return {
      suiteStatus: 'EXISTING_SUITE',
      suiteScore: 6,
      flags: ['Existing suite: KitchensBelowGrade > 0']
    };
  }
  
  // Multiplex or Duplex
  if (propertySubType === 'Multiplex' || propertySubType === 'Duplex') {
    return {
      suiteStatus: 'EXISTING_SUITE',
      suiteScore: 6,
      flags: ['Existing suite: Multiplex/Duplex property type']
    };
  }
  
  // PublicRemarks matching existing suite patterns
  const remarks = raw.PublicRemarks || '';
  const existingSuitePatterns = /(currently rented|tenant|existing.*suite|legal.*suite|second.*unit)/i;
  if (existingSuitePatterns.test(remarks)) {
    return {
      suiteStatus: 'EXISTING_SUITE',
      suiteScore: 6,
      flags: ['Existing suite: PublicRemarks indicates existing suite']
    };
  }
  
  // ── Scoring System ───────────────────────────────────────────────────────
  
  // +1: Basement has "Full" (not "Crawl Space")
  const basement = raw.Basement;
  if (basement && Array.isArray(basement)) {
    const basementStr = basement.join(' ').toLowerCase();
    if (basementStr.includes('full') && !basementStr.includes('crawl')) {
      score += 1;
      flags.push('Basement has full height');
    }
  } else if (typeof basement === 'string') {
    if (basement.toLowerCase().includes('full') && !basement.toLowerCase().includes('crawl')) {
      score += 1;
      flags.push('Basement has full height');
    }
  }
  
  // +2: Separate entrance, walk-out, or walkup
  const entrancePatterns = /(separate.*entrance|walk-out|walkup|walk-out.*basement)/i;
  if (entrancePatterns.test(remarks)) {
    score += 2;
    flags.push('Separate entrance or walk-out basement');
  }
  
  // +1: Basement bathroom OR rough-in
  const basementLevels = ['Basement', 'Lower'];
  let hasBasementBathroom = false;
  
  // Check WashroomsTypeXLevel for basement bathroom
  for (let i = 1; i <= 10; i++) {
    const levelField = `WashroomsType${i}Level`;
    if (raw[levelField]) {
      const level = String(raw[levelField]).toLowerCase();
      if (basementLevels.some(bl => level.includes(bl.toLowerCase()))) {
        hasBasementBathroom = true;
        break;
      }
    }
  }
  
  // Check for rough-in in remarks
  const roughInPatterns = /(rough[- ]?in|plumbed|roughed[- ]?in|bathroom.*rough)/i;
  const hasRoughIn = roughInPatterns.test(remarks);
  
  if (hasBasementBathroom || hasRoughIn) {
    score += 1;
    flags.push('Basement bathroom or rough-in present');
  }
  
  // +1: RoomsBelowGrade >= 2
  const roomsBelow = raw.RoomsBelowGrade || 0;
  if (roomsBelow >= 2) {
    score += 1;
    flags.push(`RoomsBelowGrade: ${roomsBelow} (>= 2)`);
  }
  
  // +1: ParkingTotal >= 2
  const parking = raw.ParkingTotal || 0;
  if (parking >= 2) {
    score += 1;
    flags.push(`ParkingTotal: ${parking} (>= 2)`);
  }
  
  // -2: ParkingTotal < 2 (fatal flaw)
  if (parking < 2) {
    score -= 2;
    flags.push(`FATAL: ParkingTotal: ${parking} (< 2) - insufficient parking`);
  }
  
  // Determine status based on score
  let suiteStatus: SuiteStatus;
  if (score >= 3) {
    suiteStatus = 'POTENTIAL_CANDIDATE';
  } else {
    suiteStatus = 'NONE';
  }
  
  return {
    suiteStatus,
    suiteScore: Math.max(0, score),
    flags
  };
}

// ============================================================================
// Legacy Derived Metrics (for backward compatibility)
// ============================================================================

interface DerivedMetrics {
  calculatedDOM: number | null;
  targetGrossYield: number | null;
  isDistressed: boolean;
  hasSecondarySuitePotential: boolean;
}

/**
 * Calculates power-user persona metrics from raw listing data.
 * @deprecated Use the new specialized functions: calculateCarryCost, calculateTrueDOM, analyzeSuitePotential
 */
export function calculateDerivedMetrics(raw: any): DerivedMetrics {
  // 1. Days on Market (calculatedDOM)
  let calculatedDOM: number | null = null;
  if (raw.OriginalEntryTimestamp) {
    const listingDate = new Date(raw.OriginalEntryTimestamp).getTime();
    const now = Date.now();
    calculatedDOM = Math.floor((now - listingDate) / (1000 * 60 * 60 * 24));
  }

  // 2. Target Gross Yield (for rental analysis)
  let targetGrossYield: number | null = null;
  if (raw.ListPrice && raw.ListPrice > 0) {
    const bedrooms = raw.BedroomsTotal || raw.BedroomsAboveGrade || 1;
    const annualRent = (bedrooms * BASELINE_RENT) * 12;
    targetGrossYield = annualRent / raw.ListPrice;
  }

  // 3. Is Distressed — phrase signals in the public remarks ONLY.
  //
  // Time-on-market and price cuts used to flip this flag too, which turned DISTRESSED into an
  // age badge (19% of actives, ~100% past 180 days) and suppressed the accurate STALE badge
  // that shares the same 90-day threshold. Those two dimensions already have honest homes:
  // `IsStale`/`TrueDom` and `TotalPriceDrop`. See src/lib/listings/distressSignals.ts.
  //
  // The matcher is shared with scripts/admin/recompute-distress-flag.ts — the nightly sync
  // only re-transforms the ModificationTimestamp delta, so a second copy of this rule would
  // leave most of the index frozen on whichever copy last wrote it.
  const { isDistressed } = detectDistress(raw.PublicRemarks);

  // 4. Has Secondary Suite Potential (legacy check)
  let hasSecondarySuitePotential = false;
  
  // Check if multiple kitchens (strong indicator of multi-unit potential)
  const kitchensTotal = raw.KitchensTotal || 0;
  if (kitchensTotal > 1) {
    hasSecondarySuitePotential = true;
  }
  
  // Check basement status for suite potential
  if (raw.Basement && Array.isArray(raw.Basement)) {
    const basementValues = raw.Basement.map((b: string) => b.toLowerCase());
    if (
      basementValues.includes('unfinished') ||
      basementValues.includes('walk-out') ||
      basementValues.includes('separate entrance')
    ) {
      hasSecondarySuitePotential = true;
    }
  }

  return {
    calculatedDOM,
    targetGrossYield: targetGrossYield !== null ? Math.round(targetGrossYield * 1000) / 1000 : null,
    isDistressed,
    hasSecondarySuitePotential
  };
}

// ============================================================================
// Main Transform Function
// ============================================================================

export interface TransformResult {
  supabasePayload: {
    listing_key: string;
    full_payload: Record<string, unknown>;
    media_urls: string[];
    derived_metrics: DerivedMetrics;
    carry_cost: CarryCostBreakdown;
    true_dom: TrueDOMResult;
    needs_geocoding: boolean;
    city: string | null;
    city_region: string | null;
    property_sub_type: string | null;
    list_price: number;
    extrapolated_cap_rate: number;
    cap_rate_est: number | null;
    property_hash: string;
    // Flat dimension columns (migration 045) — let region_active_aggregates floor on
    // beds/baths/parking/frontage/basement WITHOUT detoasting full_payload. Mirror the
    // same values extracted for Typesense below; basement_tier is the canonical 1-9 tier.
    bedrooms_total: number;
    bathrooms_total_integer: number;
    parking_total: number;
    lot_width: number;
    basement_tier: number;
    // Flat carry cost columns (migration 005)
    monthly_carry_cost: number;
    monthly_mortgage: number;
    monthly_property_tax: number;
    monthly_hoa: number;
    monthly_insurance: number;
    monthly_capex: number;
    // Flat suite analysis columns (migration 005)
    suite_status: SuiteStatus;
    suite_score: number;
    suite_flags: string[];
    // Flat true DOM columns (migration 005)
    is_stale: boolean;
    campaign_block_id: string;
    dead_days: number;
  };
  typesensePayload: {
    id: string;
    ListPrice: number;
    UnparsedAddress?: string;
    City?: string;
    CityRegion?: string;
    PostalCode?: string;
    KitchensTotal?: number;
    BedroomsTotal?: number;
    BedroomsAboveGrade?: number;
    BedroomsBelowGrade?: number;
    BathroomsTotalInteger?: number;
    PropertySubType?: string;
    PropertyType?: string;
    location: [number, number];
    TransactionType?: string;
    TaxAnnualAmount?: number;
    AssociationFee?: number;
    LotWidth?: number;
    LotDepth?: number;
    LotSqftTotal?: number;
    ApproximateAge?: string;
    ParkingTotal?: number;
    CoveredSpaces?: number;
    BuildingAreaTotal?: number;
    LivingAreaRange?: string;
    /** Interior size as half-open interval bounds; both -1 when unreported. */
    sqft_min?: number;
    sqft_max?: number;
    isDistressed: boolean;
    targetGrossYield?: number;
    hasSecondarySuitePotential: boolean;
    calculatedDOM?: number;
    primaryImageUrl?: string;
    ListOfficeName?: string;
    EntryTimestamp?: number;
    PublicRemarks?: string;
    RawImages?: string[];
    RawRooms?: any;
    TotalCapitalBasis?: number;
    ExtrapolatedCapRate?: number;
    CapitalBurnRateMonthly?: number;
    // True Carry Cost fields
    MonthlyCarryCost?: number;
    MonthlyMortgage?: number;
    MonthlyPropertyTax?: number;
    MonthlyHOA?: number;
    MonthlyInsurance?: number;
    MonthlyCapEx?: number;
    // True DOM fields
    PropertyHash?: string;
    TrueDom?: number;
    TotalPriceDrop?: number;
    LeaseTrueDom?: number;
    LeaseTotalPriceDrop?: number;
    IsStale?: boolean;
    IsSold?: boolean;
    // Suite Analysis fields
    SuiteStatus?: SuiteStatus;
    SuiteScore?: number;
    // OccupantType - required by Typesense schema but may be missing from board data
    OccupantType?: string;
    // PossessionType - also required by Typesense schema
    PossessionType?: string;
    // Normalised compass facing for the Faces filter (DirectionFaces → Exposure).
    DirectionFaces?: string;
    // Multi-Unit Scoring (Phase 2)
    multi_unit_status?: MultiUnitStatus;
    surplus_parking_count?: number;
    is_density_ready?: boolean;
    suite_confidence?: string;
    // Phase 2: Derived Financial Metrics (Cashflow Investor)
    cap_rate_est?: number;
    cap_rate_floor?: number;
    gross_yield_est?: number;
    net_monthly_cashflow?: number;
    cashflow_floor?: number;
    tax_burden_ratio?: number;
    assessment_status?: string;
    price_discovery_flag?: boolean;
    // Basement field for suite analysis
    BasementType?: string[];
    Status?: string;
    // Builder/Land Development fields
    lot_width_ft?: number;
    lot_depth_ft?: number;
    lot_area_sqft?: number;
    is_covered_land?: boolean;
    severance_candidate?: boolean;
    infrastructure_flag?: string;
    density_play?: string;
    price_per_sqft?: number;
    multiplex_by_right?: boolean;
    zoning_designation?: string;
    // ─── School-Aware Search (nearest rated school per panel) ──────────────
    ElemPublicScore?: number;
    ElemPublicSchool?: string;
    ElemPublicDistanceKm?: number;
    ElemCatholicScore?: number;
    ElemCatholicSchool?: string;
    ElemCatholicDistanceKm?: number;
    SecPublicScore?: number;
    SecPublicSchool?: string;
    SecPublicDistanceKm?: number;
    SecCatholicScore?: number;
    SecCatholicSchool?: string;
    SecCatholicDistanceKm?: number;
    BestElementaryScore?: number;
    BestSecondaryScore?: number;
    BestSchoolScoreNearby?: number;
    NearbySchools?: string[];
    // Amenity proximity (nearest grocery + recreation centre); NO_AMENITY_KM sentinel.
    NearestGroceryKm?: number;
    NearestGroceryName?: string;
    NearestRecCentreKm?: number;
    NearestRecCentreName?: string;
  };
}

/**
 * Transforms a raw ProptX API listing into dual storage payloads.
 * - supabasePayload: Full document for complete detail retrieval
 * - typesensePayload: Lean document for fast search/filter
 * 
 * Note: TrueDOM calculation requires async Supabase lookup and is handled 
 * separately by sync.ts via TemporalDistressEngine. This function provides
 * the hash only, actual TrueDOM is computed post-transform.
 */
export async function transformListing(raw: any): Promise<TransformResult> {
  // Resolve geolocation with fallback chain
  const geo = resolveLocation(
    raw.PostalCode,
    raw.Latitude,
    raw.Longitude,
    raw.City
  );

  // Calculate derived metrics
  const metrics = calculateDerivedMetrics(raw);
  
  // Calculate True Carry Cost
  const carryCost = calculateCarryCost(raw);
  
  // Calculate True DOM (synchronous hash-based calculation)
  // Note: Full historical TrueDOM is computed by sync.ts via TemporalDistressEngine
  // This provides the property hash and basic DOM for immediate use
  const propertyHash = hashPropertyAddress(raw);
  const entryTimestamp = raw.OriginalEntryTimestamp 
    ? new Date(raw.OriginalEntryTimestamp).getTime() 
    : Date.now();
  const now = Date.now();
  const basicDOM = Math.floor((now - entryTimestamp) / (1000 * 60 * 60 * 24));
  const trueDOM: TrueDOMResult = {
    propertyHash,
    trueDOM: basicDOM,
    isStale: basicDOM > 90,
    campaignBlockId: raw.ListingKey || '',
    deadDays: Math.max(0, basicDOM - 30)
  };
  
  // Analyze Suite Potential
  const suiteAnalysis = analyzeSuitePotential(raw);

  // Phase 2: Multi-Unit Potential Scoring
  const multiUnitResult = calculateMultiUnitPotential(raw);
  
  // Phase 2: Surplus Parking Calculation
  const parkingResult = calculateSurplusParking(raw);

  // === Phase 3: Rent AVM (async Supabase lookup) ===
  const isSuiteCandidate = ['EXISTING_MULTI_UNIT', 'PRIME_CANDIDATE', 'MARGINAL_CANDIDATE'].includes(multiUnitResult.multi_unit_status);
  let rentAVM: RentAVMResult = { annual_rent: 0, annual_rent_p10: 0, has_data: false, match_tier: null };
  try {
    rentAVM = await fetchRentAVM({
      city: raw.City || '',
      cityRegion: raw.CityRegion || raw.City || '',
      propertySubType: raw.PropertySubType || '',
      bedroomsTotal: raw.BedroomsTotal || 0,
      // The plus-room split (migration 122): a 1+den is not a 2 bedroom and leases
      // ~$500/mo below one. Passing these picks the split cohort; omitting them
      // silently degrades to the merged one.
      bedroomsAboveGrade: raw.BedroomsAboveGrade,
      bedroomsBelowGrade: raw.BedroomsBelowGrade,
      // Real bath count drives the tiered rent lookup (replaces WashroomsType1Pcs).
      bathroomsTotal: raw.BathroomsTotalInteger || 0,
      isSuiteCandidate,
    });
  } catch (err) {
    console.warn('[Transformer] Rent AVM lookup failed:', err);
  }

  // === Phase 3: Ratio-price basis & Mill Rate (async Supabase lookups) ===
  let ratioPrice = { calculation_price: raw.ListPrice || 0, is_price_discovery: false };
  let millRate = { base_mill_rate: 0.0095, city: raw.City || '' };
  try {
    [ratioPrice, millRate] = await Promise.all([
      resolveRatioPrice({
        listPrice: raw.ListPrice || 0,
        propertySubType: raw.PropertySubType || '',
        cityRegion: raw.CityRegion || raw.City || '',
      }),
      fetchMillRate(raw.CityRegion || raw.City || ''),
    ]);
  } catch (err) {
    console.warn('[Transformer] Ratio-price/Mill Rate lookup failed:', err);
  }

  // === Phase 3: Financial Metrics Calculation ===
  const isCondo = !!(raw.PropertyType?.includes('Condo') || raw.CondoCorpNumber);
  const metrics3 = calculateFinancialMetrics({
    annual_rent: rentAVM.annual_rent,
    annual_rent_p10: rentAVM.annual_rent_p10,
    has_rent_data: rentAVM.has_data,
    calculation_price: ratioPrice.calculation_price,
    is_price_discovery: ratioPrice.is_price_discovery,
    propertySubType: raw.PropertySubType || '',
    listPrice: raw.ListPrice || 0,
    // For-lease listings carry monthly rent in ListPrice — the engine zeroes
    // cap rate/yield/cashflow for them rather than emitting absurd 1000%+ figures.
    transactionType: raw.TransactionType,
    taxAnnualAmount: raw.TaxAnnualAmount ?? null,
    associationFee: raw.AssociationFee ?? null,
    maintenanceExpense: raw.MaintenanceExpense ?? null,
    insuranceExpense: raw.InsuranceExpense ?? null,
    baseMillRate: millRate.base_mill_rate,
    multiUnitStatus: multiUnitResult.multi_unit_status,
    isCondo,
  });

  // === Phase 4: Builder/Land Development Metrics ===
  const builderMetrics = processBuilderMetrics(raw);

  // Thumbnail + full image list — shared helper so the sold indexer applies the
  // same selection rule (see src/lib/etl/selectPrimaryImage.ts for priority).
  const primaryThumbnailUrl = selectPrimaryImage(raw);
  const mediaUrls = collectMediaUrls(raw);

  // Extrapolated Cap Rate (§4: derived metric computed in the Node ETL). Computed here so
  // it can be both persisted to Supabase (for region aggregation) and set on the Typesense
  // doc below.
  const proForma = calculateProForma(raw.ListPrice, {
    listPrice: raw.ListPrice,
    taxAnnualAmount: raw.TaxAnnualAmount ?? null,
    associationFee: raw.AssociationFee ?? null
  });

  // Build Supabase payload (full document)
  const supabasePayload = {
    listing_key: raw.ListingKey,
    // `media` is stripped before storing (migration 103). It was ~20 KB/row of photo
    // objects duplicating media_urls below, which is what every render path actually
    // reads — and the largest single thing in the database. `raw` is NOT mutated:
    // mediaUrls/primaryThumbnailUrl above are already derived from it, and the caller
    // (sync.ts) still needs raw.media for the Typesense doc.
    full_payload: stripStoredMedia(raw),
    media_urls: mediaUrls,
    derived_metrics: metrics,
    carry_cost: carryCost,
    needs_geocoding: geo.needsGeocoding,
    city: raw.City || null,
    city_region: raw.CityRegion || null,
    property_sub_type: raw.PropertySubType || null,
    list_price: raw.ListPrice || 0,
    extrapolated_cap_rate: proForma.extrapolated_cap_rate,
    // Real IDX-derived cap rate (de-fake §6.2) — NULL when no rent estimate so the region
    // RPC excludes it rather than averaging a 0. extrapolated_cap_rate stays until the
    // engine is retired (§9); region_active_aggregates reads only cap_rate_est.
    cap_rate_est: metrics3?.cap_rate_est || null,
    property_hash: trueDOM.propertyHash,
    // Flat dimension columns (migration 045). Same extraction as the Typesense payload
    // below (0 = missing, mirrors that path) so the region RPC never has to detoast
    // full_payload for these floors. basement_tier via the canonical shared deriver.
    bedrooms_total: numOr0(raw.BedroomsTotal),
    bathrooms_total_integer: numOr0(raw.BathroomsTotalInteger),
    parking_total: numOr0(raw.ParkingTotal),
    lot_width: numOr0(raw.LotWidth),
    basement_tier: deriveBasementTier(raw as Record<string, unknown>),
    // Flat carry cost columns (migration 005)
    monthly_carry_cost: carryCost.trueCarryCost,
    monthly_mortgage: carryCost.monthlyMortgage,
    monthly_property_tax: carryCost.monthlyPropertyTax,
    monthly_hoa: carryCost.monthlyHOA,
    monthly_insurance: carryCost.monthlyInsurance,
    monthly_capex: carryCost.monthlyCapEx,
    // Flat suite analysis columns (migration 005)
    suite_status: suiteAnalysis.suiteStatus,
    suite_score: suiteAnalysis.suiteScore,
    suite_flags: suiteAnalysis.flags,
    // Flat true DOM columns (migration 005)
    is_stale: trueDOM.isStale,
    campaign_block_id: trueDOM.campaignBlockId,
    dead_days: trueDOM.deadDays,
    true_dom: trueDOM
  };

  // Build Typesense payload (lean document)
  const typesensePayload: TransformResult['typesensePayload'] = {
    id: raw.ListingKey,
    ListPrice: raw.ListPrice || 0,
    location: geo.location,
    isDistressed: metrics.isDistressed,
    hasSecondarySuitePotential: suiteAnalysis.suiteStatus !== 'NONE',
    // Timestamp for fast sorting by entry date. Fallback chain matters: the old
    // Date.now() fallback re-stamped a no-OriginalEntryTimestamp listing as brand-new on
    // EVERY re-sync, making it reappear forever in "new listing" queries and the nightly
    // bubble alerts. ListingContractDate is the honest proxy; 0 (= unknown, sorts last,
    // excluded from every "new since X" window) beats a fabricated freshness.
    EntryTimestamp: raw.OriginalEntryTimestamp
      ? new Date(raw.OriginalEntryTimestamp).getTime()
      : raw.ListingContractDate
        ? new Date(raw.ListingContractDate).getTime()
        : 0,
    // True Carry Cost fields
    MonthlyCarryCost: carryCost.trueCarryCost,
    MonthlyMortgage: carryCost.monthlyMortgage,
    MonthlyPropertyTax: carryCost.monthlyPropertyTax,
    MonthlyHOA: carryCost.monthlyHOA,
    MonthlyInsurance: carryCost.monthlyInsurance,
    MonthlyCapEx: carryCost.monthlyCapEx,
    // True DOM fields
    PropertyHash: trueDOM.propertyHash,
    TrueDom: trueDOM.trueDOM,
    // TotalPriceDrop is a Typesense-required int32; sync.ts overwrites it with
    // the real chain delta after the historical lookup, but we emit a 0
    // placeholder here so the schema contract holds for any other caller.
    TotalPriceDrop: 0,
    // LEASE-track twins (rental-native metrics) — same contract as TotalPriceDrop:
    // required int32s that sync.ts overwrites from the campaign stitch. 0 placeholder.
    LeaseTrueDom: 0,
    LeaseTotalPriceDrop: 0,
    IsStale: trueDOM.isStale,
    // IsSold: defaults to false, sync.ts will set true for sold listings
    IsSold: false,
    // Suite Analysis fields
    SuiteStatus: suiteAnalysis.suiteStatus,
    SuiteScore: suiteAnalysis.suiteScore,
    // Phase 2: Multi-Unit Scoring
    multi_unit_status: multiUnitResult.multi_unit_status,
    surplus_parking_count: parkingResult.surplus_parking_count,
    is_density_ready: parkingResult.is_density_ready,
    suite_confidence: multiUnitResult.suite_confidence ?? ''
  };

  // Add optional fields with fallbacks to ensure schema compliance
  typesensePayload.UnparsedAddress = raw.UnparsedAddress || '';
  typesensePayload.City = raw.City || '';
  typesensePayload.CityRegion = raw.CityRegion || '';
  typesensePayload.PostalCode = raw.PostalCode || '';
  typesensePayload.KitchensTotal = (raw.KitchensTotal !== undefined && raw.KitchensTotal !== null) ? parseInt(String(raw.KitchensTotal), 10) : 0;
  typesensePayload.BedroomsTotal = (raw.BedroomsTotal !== undefined && raw.BedroomsTotal !== null) ? parseInt(String(raw.BedroomsTotal), 10) : 0;
  // Above/below-grade split powers the "4+1" card label (4 above, 1 below).
  typesensePayload.BedroomsAboveGrade = (raw.BedroomsAboveGrade !== undefined && raw.BedroomsAboveGrade !== null) ? parseInt(String(raw.BedroomsAboveGrade), 10) : 0;
  typesensePayload.BedroomsBelowGrade = (raw.BedroomsBelowGrade !== undefined && raw.BedroomsBelowGrade !== null) ? parseInt(String(raw.BedroomsBelowGrade), 10) : 0;
  typesensePayload.BathroomsTotalInteger = (raw.BathroomsTotalInteger !== undefined && raw.BathroomsTotalInteger !== null) ? parseFloat(String(raw.BathroomsTotalInteger)) : 0;
  typesensePayload.PropertySubType = raw.PropertySubType || '';
  typesensePayload.PropertyType = raw.PropertyType || '';
  typesensePayload.TransactionType = raw.TransactionType || '';
  typesensePayload.TaxAnnualAmount = (raw.TaxAnnualAmount !== undefined && raw.TaxAnnualAmount !== null) ? parseFloat(String(raw.TaxAnnualAmount)) : 0;
  typesensePayload.AssociationFee = (raw.AssociationFee !== undefined && raw.AssociationFee !== null) ? parseFloat(String(raw.AssociationFee)) : 0;
  typesensePayload.LotWidth = (raw.LotWidth !== undefined && raw.LotWidth !== null) ? parseFloat(String(raw.LotWidth)) : 0;
  typesensePayload.LotDepth = (raw.LotDepth !== undefined && raw.LotDepth !== null) ? parseFloat(String(raw.LotDepth)) : 0;
  typesensePayload.LotSqftTotal = (raw.LotWidth && raw.LotDepth) ? parseFloat(String(raw.LotWidth)) * parseFloat(String(raw.LotDepth)) : 0;
  typesensePayload.ApproximateAge = raw.ApproximateAge || '';
  typesensePayload.Status = raw.Status || raw.MlsStatus || raw.StandardStatus || '';
  typesensePayload.ParkingTotal = (raw.ParkingTotal !== undefined && raw.ParkingTotal !== null) ? raw.ParkingTotal : 0;
  // Garage (covered) spaces — size/frontage proxy for the comparables matcher. Emitted
  // ONLY when present so "unknown" stays absent (neutral score) vs. 0 = "no garage".
  if (raw.CoveredSpaces !== undefined && raw.CoveredSpaces !== null) {
    typesensePayload.CoveredSpaces = parseInt(String(raw.CoveredSpaces), 10);
  }
  typesensePayload.BuildingAreaTotal = (raw.BuildingAreaTotal !== undefined && raw.BuildingAreaTotal !== null) ? parseFloat(String(raw.BuildingAreaTotal)) : 0;
  // LivingAreaRange — TRREB sqft band ("2500-3000"). Stored-only display cargo (like
  // BuildingAreaTotal): undeclared in the schema, so returned but not filter/sortable.
  // BuildingAreaTotal is ~never filled for houses, so this is the headline sqft fallback.
  typesensePayload.LivingAreaRange = raw.LivingAreaRange || '';
  // …and the same size as a filterable INTERVAL. Residential sqft is 100% banded
  // (measured 2026-07-30: 81,555/81,570 houses and 37,932/37,933 condos carry a
  // band, zero carry an exact value), so collapsing to a midpoint would make every
  // size query assert a precision the feed cannot support. Indexing both bounds
  // keeps "definitely in range" and "might be in range" separable.
  const sqft = sqftBoundsFor(raw);
  typesensePayload.sqft_min = sqft.lo;
  typesensePayload.sqft_max = sqft.hi;
  // targetGrossYield emit removed 2026-06-10: its filter consumers went in PR #13; storing it in Typesense is dead weight.
  if (metrics.calculatedDOM !== null) typesensePayload.calculatedDOM = metrics.calculatedDOM;
  typesensePayload.primaryImageUrl = primaryThumbnailUrl || '';
  typesensePayload.ListOfficeName = raw.ListOfficeName || '';
  typesensePayload.PublicRemarks = raw.PublicRemarks || '';
  if (mediaUrls.length > 0) typesensePayload.RawImages = mediaUrls;
  else typesensePayload.RawImages = [];
  if (raw.rooms) typesensePayload.RawRooms = raw.rooms;
  else typesensePayload.RawRooms = [];
  if (raw.Basement && Array.isArray(raw.Basement)) typesensePayload.BasementType = raw.Basement;
  else typesensePayload.BasementType = [];
  
  // OccupantType - required by Typesense schema but may not exist in board data
  typesensePayload.OccupantType = raw.OccupantType || '';

  // PossessionType - also required by Typesense schema
  typesensePayload.PossessionType = raw.PossessionType || '';

  // Compass facing for the Faces filter — DirectionFaces (houses) → Exposure (condos),
  // normalised to one of the 8 points or '' (see src/lib/listings/directionFaces.ts).
  typesensePayload.DirectionFaces = normalizeDirectionFaces(raw);

  // Phase 3: Extrapolated Cap Rate (proForma computed above, before the Supabase payload).
  typesensePayload.TotalCapitalBasis = proForma.total_capital_basis;
  typesensePayload.ExtrapolatedCapRate = proForma.extrapolated_cap_rate;
  typesensePayload.CapitalBurnRateMonthly = proForma.capital_burn_rate_monthly;

  // Phase 3: Financial Metrics from AVM and TrueValue services
  // These override the Phase 2 placeholder calculations with real data
  if (metrics3) {
    typesensePayload.cap_rate_est = metrics3.cap_rate_est ?? 0;
    typesensePayload.cap_rate_floor = metrics3.cap_rate_floor ?? 0;
    typesensePayload.gross_yield_est = metrics3.gross_yield_est ?? 0;
    typesensePayload.net_monthly_cashflow = metrics3.net_monthly_cashflow ?? 0;
    typesensePayload.cashflow_floor = metrics3.cashflow_floor ?? 0;
    typesensePayload.tax_burden_ratio = metrics3.tax_burden_ratio ?? 0;
    typesensePayload.assessment_status = metrics3.assessment_status || 'MARKET_AVERAGE';
  }

  // Price discovery flag from TrueValue service
  typesensePayload.price_discovery_flag = ratioPrice.is_price_discovery;

  // Builder/Land Development metrics
  (typesensePayload as any).lot_width_ft = builderMetrics.lot_width_ft;
  (typesensePayload as any).lot_depth_ft = builderMetrics.lot_depth_ft;
  (typesensePayload as any).lot_area_sqft = builderMetrics.lot_area_sqft;
  (typesensePayload as any).is_covered_land = builderMetrics.is_covered_land;
  (typesensePayload as any).severance_candidate = builderMetrics.severance_candidate;
  (typesensePayload as any).infrastructure_flag = builderMetrics.infrastructure_flag;
  (typesensePayload as any).density_play = builderMetrics.density_play;
  (typesensePayload as any).price_per_sqft = builderMetrics.price_per_sqft;
  (typesensePayload as any).multiplex_by_right = builderMetrics.multiplexByRight;
  (typesensePayload as any).zoning_designation = builderMetrics.zoningDesignation;

  // School-Aware Search: nearest rated school per panel (deterministic, §4/§6).
  // Every declared key is written with built-in 0/''/[] fallbacks from assignSchools.
  const schools = assignSchools(geo.location);
  typesensePayload.ElemPublicScore = schools.ElemPublicScore;
  typesensePayload.ElemPublicSchool = schools.ElemPublicSchool;
  typesensePayload.ElemPublicDistanceKm = schools.ElemPublicDistanceKm;
  typesensePayload.ElemCatholicScore = schools.ElemCatholicScore;
  typesensePayload.ElemCatholicSchool = schools.ElemCatholicSchool;
  typesensePayload.ElemCatholicDistanceKm = schools.ElemCatholicDistanceKm;
  typesensePayload.SecPublicScore = schools.SecPublicScore;
  typesensePayload.SecPublicSchool = schools.SecPublicSchool;
  typesensePayload.SecPublicDistanceKm = schools.SecPublicDistanceKm;
  typesensePayload.SecCatholicScore = schools.SecCatholicScore;
  typesensePayload.SecCatholicSchool = schools.SecCatholicSchool;
  typesensePayload.SecCatholicDistanceKm = schools.SecCatholicDistanceKm;
  typesensePayload.BestElementaryScore = schools.BestElementaryScore;
  typesensePayload.BestSecondaryScore = schools.BestSecondaryScore;
  typesensePayload.BestSchoolScoreNearby = schools.BestSchoolScoreNearby;
  typesensePayload.NearbySchools = schools.NearbySchools;

  // Amenity proximity: nearest grocery + recreation centre (deterministic, §4/§6).
  // Distances use the NO_AMENITY_KM sentinel (not 0) so the walkability filter
  // (NearestGroceryKm:<=X) can't false-match listings with nothing nearby.
  const amenities = assignAmenities(geo.location);
  typesensePayload.NearestGroceryKm = amenities.NearestGroceryKm;
  typesensePayload.NearestGroceryName = amenities.NearestGroceryName;
  typesensePayload.NearestRecCentreKm = amenities.NearestRecCentreKm;
  typesensePayload.NearestRecCentreName = amenities.NearestRecCentreName;

  return { supabasePayload, typesensePayload };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Test transformer with a mock listing
 */
export async function testTransformer() {
  const mockListing = {
    ListingKey: 'MLS123456',
    ListPrice: 1250000,
    City: 'Brampton',
    CityRegion: 'Brampton',
    PostalCode: 'L6P 2Z1',
    Latitude: null,
    Longitude: null,
    BedroomsTotal: 4,
    BathroomsTotalInteger: 3,
    PropertySubType: 'Detached',
    PropertyType: 'Residential',
    TransactionType: 'For Sale',
    OriginalEntryTimestamp: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    PublicRemarks: 'Beautiful family home with separate entrance to basement. Tenant currently renting basement unit.',
    Basement: ['Finished', 'Full'],
    KitchensTotal: 2,
    KitchensBelowGrade: 1,
    RoomsBelowGrade: 3,
    ParkingTotal: 4,
    TaxAnnualAmount: 6500,
    AssociationFee: 0,
    ApproximateAge: '10-15',
    ListOfficeName: 'EXP Realty',
    WashroomsType1Level: 'Ground',
    WashroomsType2Level: 'Second Floor',
    media: [
      { MediaURL: 'https://example.com/photo1.jpg', MediaStatus: 'Active' },
      { MediaURL: 'https://example.com/photo2.jpg', MediaStatus: 'Active' }
    ]
  };

  console.log('\n🧪 Testing Transformer with mock listing:');
  console.log('Input:', JSON.stringify(mockListing, null, 2));
  
  const result = await transformListing(mockListing);
  
  console.log('\n📦 Supabase Payload:');
  console.log(JSON.stringify(result.supabasePayload, null, 2));
  
  console.log('\n🔍 Typesense Payload:');
  console.log(JSON.stringify(result.typesensePayload, null, 2));
  
  console.log('\n💰 Carry Cost Breakdown:');
  console.log(JSON.stringify(result.supabasePayload.carry_cost, null, 2));
  
  console.log('\n📊 True DOM:');
  console.log(JSON.stringify(result.supabasePayload.true_dom, null, 2));
  
  console.log('\n🏠 Suite Analysis (via flat columns):');
  console.log(`   suite_status: ${result.supabasePayload.suite_status}`);
  console.log(`   suite_score: ${result.supabasePayload.suite_score}`);
  console.log(`   suite_flags: ${result.supabasePayload.suite_flags.join(', ')}`);
  
  console.log('\n✅ Transformer test complete!');
  return result;
}

// Run if executed directly
if (require.main === module) {
  (async () => {
    try {
      await testTransformer();
      console.log('\n✅ Transformer test complete!');
      process.exit(0);
    } catch (err: any) {
      console.error('Transformer test failed:', err);
      process.exit(1);
    }
  })();
}