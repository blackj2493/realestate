/**
 * Stable string identity for the SCOPE-relevant part of a MarketActivityLens —
 * everything `buildScopeFilter` consumes (sale/lease, type, beds, baths, parking,
 * basement, frontage), but NOT `windowDays` (that only affects activity counts).
 *
 * Used as a React effect dependency so scope-driven fetches (boards, stat tiles,
 * specialty shares) re-run when the filter changes but NOT when the activity
 * window alone toggles.
 */

import type { MarketActivityLens } from './config';

export function scopeKey(lens: MarketActivityLens): string {
  return [
    lens.transactionType,
    [...lens.propertyTypes].sort().join(","),
    lens.minBeds,
    lens.bedsExact ? "e" : "m",
    lens.minBaths,
    lens.bathsExact ? "e" : "m",
    lens.minGarage,
    lens.garageExact ? "e" : "m",
    lens.basement,
    lens.minFrontage,
  ].join("|");
}
