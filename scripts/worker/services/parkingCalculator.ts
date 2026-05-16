/**
 * Surplus Parking Calculator
 * Phase 2: Cashflow Investor Persona - Density Ready Flag
 * 
 * Calculates surplus parking spaces and determines if property qualifies
 * as a "density ready" candidate (surplus parking >= 2 AND Detached).
 */

import 'dotenv/config';

export interface ParkingResult {
  surplus_parking_count: number;
  is_density_ready: boolean;
}

/**
 * Calculate surplus parking and density readiness.
 * 
 * Mutual/Shared driveway killswitch → 0 surplus, not density ready.
 * 
 * Required baseline: 2 for Detached/Semi-Detached, 1 for Condo Apt.
 * Surplus = max(0, ParkingTotal - requiredBaseline)
 * 
 * Density Ready: surplus >= 2 AND PropertySubType === 'Detached'
 */
export function calculateSurplusParking(listing: any): ParkingResult {
  const propertySubType = listing.PropertySubType || '';
  const parkingFeatures = listing.ParkingFeatures || [];
  const remarks = listing.PublicRemarks || '';
  const coveredSpaces = listing.CoveredSpaces ?? 0;
  
  // ── Mutual/Shared Driveway Killswitch ────────────────────────────────────────
  if (
    (Array.isArray(parkingFeatures) && parkingFeatures.some((f: string) => /mutual|shared/i.test(String(f)))) ||
    /(mutual driveway|shared drive|no parking)/i.test(remarks)
  ) {
    return { surplus_parking_count: 0, is_density_ready: false };
  }
  
  // ── Base Parking Calculation ─────────────────────────────────────────────────
  let parkingTotal = listing.ParkingTotal ?? 0;
  if (!parkingTotal) {
    // Fallback: assume 2 driveway spaces for detached/semi if no covered spaces
    parkingTotal = coveredSpaces + (propertySubType === 'Detached' || propertySubType === 'Semi-Detached' ? 2 : 0);
  }
  
  // ── Required Baseline ─────────────────────────────────────────────────────────
  const requiredBaseline = propertySubType === 'Condo Apt' ? 1.0 : 2.0;
  const surplus = Math.max(0, parkingTotal - requiredBaseline);
  
  // ── Density Ready Flag ───────────────────────────────────────────────────────
  // is_density_ready: surplus >= 2.0 AND PropertySubType === 'Detached'
  const is_density_ready = surplus >= 2.0 && propertySubType === 'Detached';
  
  return {
    surplus_parking_count: surplus,
    is_density_ready,
  };
}

export default calculateSurplusParking;