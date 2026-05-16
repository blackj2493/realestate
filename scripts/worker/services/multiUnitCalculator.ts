/**
 * Multi-Unit Potential Calculator
 * Phase 2: Cashflow Investor Persona Scoring Engine
 * 
 * Determines whether a property qualifies as a multi-unit conversion candidate
 * based on basement foundation, ingress/egress, plumbing, and parking bylaws.
 */

import 'dotenv/config';

export type MultiUnitStatus = 'NOT_VIABLE' | 'EXISTING_MULTI_UNIT' | 'PRIME_CANDIDATE' | 'MARGINAL_CANDIDATE';

export interface MultiUnitResult {
  multi_unit_status: MultiUnitStatus;
  suite_confidence: 'INHERITED_TENANT_RISK' | 'TARGET_YIELD' | null;
}

/**
 * Calculate multi-unit potential for a listing.
 * 
 * Killswitch: Condo, CondoCorpNumber, Condo Townhouse → NOT_VIABLE
 * 
 * Existing Multi-Unit Detection:
 * - PropertySubType in [Duplex, Triplex, Multiplex, Fourplex]
 * - KitchensBelowGrade > 0
 * - Basement includes 'Apartment'
 * - PublicRemarks matches /(existing suite|in-law suite|currently rented|basement apt)/i
 * 
 * Alpha Scoring Matrix:
 * +1: Basement Foundation (Full, Finished, Unfinished - not Crawl Space/None/Half)
 * +2: Ingress/Egress (Separate Entrance, Walk-Out, Walk-Up)
 * +1: Plumbing Infrastructure (basement bathroom or rough-in)
 * +1/-2: Parking Bylaws (3+ = +1, <2 = -2)
 */
export function calculateMultiUnitPotential(listing: any): MultiUnitResult {
  const propertyType = listing.PropertyType || '';
  const propertySubType = listing.PropertySubType || '';
  const condoCorpNumber = listing.CondoCorpNumber;
  const basement = listing.Basement || [];
  const remarks = listing.PublicRemarks || '';
  const kitchensBelowGrade = listing.KitchensBelowGrade;
  
  // ── Strata Killswitch ─────────────────────────────────────────────────────────
  if (
    propertyType.includes('Condo') ||
    condoCorpNumber ||
    propertySubType === 'Condo Townhouse'
  ) {
    return { multi_unit_status: 'NOT_VIABLE', suite_confidence: null };
  }
  
  // ── Existing Multi-Unit Detection ─────────────────────────────────────────────
  const existingMultiUnitTypes = ['Duplex', 'Triplex', 'Multiplex', 'Fourplex'];
  if (
    existingMultiUnitTypes.includes(propertySubType) ||
    (kitchensBelowGrade && kitchensBelowGrade > 0) ||
    (Array.isArray(basement) && basement.some((b: string) => b.includes('Apartment')))
  ) {
    return { multi_unit_status: 'EXISTING_MULTI_UNIT', suite_confidence: null };
  }
  
  // Regex fallback for existing suite patterns
  if (/(existing suite|in-law suite|currently rented|basement apt|legal suite)/i.test(remarks)) {
    return { multi_unit_status: 'EXISTING_MULTI_UNIT', suite_confidence: null };
  }
  
  // ── Alpha Scoring Matrix ───────────────────────────────────────────────────────
  let score = 0;
  
  // Rule A: Basement Foundation (+1)
  // Fatal Flaw: Crawl Space / None / Half → NOT_VIABLE
  const fatalBasementTypes = ['Crawl Space', 'None', 'Half'];
  if (Array.isArray(basement) && basement.some((b: string) => fatalBasementTypes.includes(b))) {
    return { multi_unit_status: 'NOT_VIABLE', suite_confidence: null };
  }
  if (Array.isArray(basement) && basement.some((b: string) => ['Full', 'Finished', 'Unfinished'].includes(b))) {
    score += 1;
  }
  
  // Rule B: Ingress/Egress (+2)
  const egressTypes = ['Separate Entrance', 'Walk-Out', 'Finished with Walk-Out', 'Walk-Up'];
  if (Array.isArray(basement) && basement.some((b: string) => egressTypes.includes(b))) {
    score += 2;
  } else if (/(sep(arate)? ent(rance)?|side door|garage access to basement|walk(-)?out)/i.test(remarks)) {
    score += 2;
  }
  
  // Rule C: Plumbing Infrastructure (+1)
  const washroomLevels = [
    listing.WashroomsType1Level,
    listing.WashroomsType2Level,
    listing.WashroomsType3Level,
  ].filter(Boolean);
  
  if (washroomLevels.some((l: string) => /Basement|Lower/i.test(String(l)))) {
    score += 1;
  } else if (/(rough(-)?in|basement bath)/i.test(remarks)) {
    score += 1;
  }
  
  // Rule D: Parking Bylaws (+1 / -2)
  const parkingTotal = listing.ParkingTotal ?? 0;
  if (parkingTotal >= 3) {
    score += 1;
  } else if (parkingTotal < 2) {
    score -= 2;
  }
  
  // ── Classification ───────────────────────────────────────────────────────────
  let multi_unit_status: MultiUnitStatus;
  if (score >= 3) {
    multi_unit_status = 'PRIME_CANDIDATE';
  } else if (score === 2) {
    multi_unit_status = 'MARGINAL_CANDIDATE';
  } else {
    multi_unit_status = 'NOT_VIABLE';
  }
  
  // ── Suite Confidence ─────────────────────────────────────────────────────────
  // Inherited Tenant Risk scan
  const inheritedTenantRisk = /(tenant assumes|assuming tenant|currently rented at|month to month)/i.test(remarks);
  const suite_confidence: 'INHERITED_TENANT_RISK' | 'TARGET_YIELD' | null = 
    inheritedTenantRisk ? 'INHERITED_TENANT_RISK' : null;
  
  return { multi_unit_status, suite_confidence };
}

export default calculateMultiUnitPotential;