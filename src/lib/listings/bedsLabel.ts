/**
 * "4+1" bed label — above-grade beds, plus below-grade when present.
 *
 * Single source of truth so the Command Center cards (ListingCardBody), the
 * Quick Look drawer (QuickLookPanel), and the server-rendered /properties/[id]
 * detail page all render beds identically. Pure (no React, no "use client") so it can
 * be imported by Server Components too.
 *
 * Falls back to the total when above-grade is missing or stored as 0 (TRREB
 * sometimes leaves BedroomsAboveGrade empty while BedroomsTotal carries the
 * 4+1 = 5 sum). Returns null when there's no bed data at all.
 */
export interface BedCounts {
  BedroomsAboveGrade?: number | null;
  BedroomsBelowGrade?: number | null;
  BedroomsTotal?: number | null;
}

export function bedsLabel(p: BedCounts): string | null {
  const above = p.BedroomsAboveGrade && p.BedroomsAboveGrade > 0 ? p.BedroomsAboveGrade : p.BedroomsTotal ?? 0;
  const below = p.BedroomsBelowGrade ?? 0;
  if (!above && !below) return null;
  return below > 0 ? `${above}+${below}` : `${above}`;
}
