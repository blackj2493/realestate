/**
 * Shared types for Search V2. Kept dependency-light (type-only import of the
 * listing doc) so both the client UI and any server route can use them.
 */

import type { ListingDocument } from "@/lib/typesense/client";

// ── Federated, categorized suggestions ──────────────────────────────────────

export type SuggestCategory =
  | "address" // active for-sale/-rent listing matched by street address
  | "sold" // comps-on-demand action row (lights the sold layer)
  | "soldAddress" // THIS typed address has a sold/leased/off-market record (price VOW-gated)
  | "community" // city / neighbourhood (with live active count)
  | "school" // a rated school (proximity filter)
  | "mls" // exact MLS# → opens that listing
  | "geo"; // free-typed address resolved by geocoder → fly the map

export interface SuggestItem {
  /** Stable key for React + dedupe. */
  id: string;
  category: SuggestCategory;
  label: string;
  sublabel?: string;
  /** Active-listing count — communities only. */
  count?: number;
  /** Full doc — address / mls / sold rows carry it so we can open or fly. */
  listing?: ListingDocument;
  /** Fly-to target — geo / community / address rows. */
  geo?: { lat: number; lng: number; zoom?: number };
  /** Short "why it matched" tag, e.g. "address", "community", "school". */
  provenance?: string;
  /** Sold metadata (price intentionally absent when gated). */
  sold?: {
    dateLabel?: string;
    priceMasked: boolean;
    /** "$1,625,000" — consumers only; never present on an anonymous payload. */
    priceLabel?: string;
    /** Keyed /address page for the record (soldAddress rows). */
    href?: string;
    /** SOLD / LEASED / OFF MARKET — the public status kind (audit R24a). */
    kindLabel?: string;
  };
  /** School metadata. */
  school?: { id: string; score?: number };
}

/** /api/search/address-status response — the dropdown's sold-record probe. */
export interface AddressStatusResponse {
  found: boolean;
  key?: string;
  address?: string;
  city?: string;
  /** Public status kind — shown to anon too (same signal /address shows, R24a). */
  dealKind?: "sold" | "leased" | "offmarket";
  href?: string;
  /** VOW fields — present ONLY on a signed-in consumer's response. */
  closePrice?: number;
  /** Epoch ms (UTC-midnight date-only) — render with timeZone:'UTC' (MEDIUM-18). */
  soldDateMs?: number;
  beds?: number;
  baths?: number;
  subType?: string;
}

export interface SuggestGroup {
  category: SuggestCategory;
  title: string;
  items: SuggestItem[];
}

// ── Natural-language → editable chips ───────────────────────────────────────

export type ChipKind =
  | "location"
  | "priceMin"
  | "priceMax"
  | "beds"
  | "baths"
  | "homeType"
  | "basement"
  | "school"
  | "parking"
  | "staleOnly"
  | "priceDrop";

export interface ParsedChip {
  /** Stable id (kind + value) so chips can be removed idempotently. */
  id: string;
  kind: ChipKind;
  /** Display text, e.g. "≤ $800K", "3+ Beds", "Hamilton". */
  label: string;
  /** Normalized value applied to the store (number, string, or option list). */
  value: number | string | string[];
}

export interface ParsedQuery {
  chips: ParsedChip[];
  /** Words we couldn't map — surfaced for honest "read N of your words" provenance. */
  unmatched: string;
  /** True when ≥1 structured chip was extracted (treat input as an NL query). */
  isStructured: boolean;
}

// ── Answer-card (area sold stats) ───────────────────────────────────────────

export interface AreaSoldStats {
  area: string;
  windowDays: number;
  sales: number;
  /** Dollar medians are null when gated (anonymous) or unknown. */
  medianSold: number | null;
  pricePerSqft: number | null;
  pricePerSqftYoyPct: number | null;
  medianDom: number | null;
  /** Sparkline series (oldest → newest); empty when unavailable. */
  trend: number[];
  /** True → dollar figures are masked for the anonymous viewer. */
  gated: boolean;
}
