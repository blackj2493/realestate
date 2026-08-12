/**
 * Shared types for Search V2. Kept dependency-light (type-only import of the
 * listing doc) so both the client UI and any server route can use them.
 */

import type { ListingDocument } from "@/lib/typesense/client";
import type { RowStatus, SearchSection } from "./searchRows";

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
  /** Row status for a LIVE listing — for sale vs for lease, from the feed's own
   *  TransactionType. Records carry theirs on `sold.kind` instead. */
  status?: RowStatus;
  /** "Jun 25, 2026 · X13491562 · ROYAL LEPAGE TEAM REALTY" — the provenance line under a
   *  listing row. Public on both kinds; the date is what separates campaigns. */
  meta?: string;
  /** Sold metadata (price intentionally absent when gated). */
  sold?: {
    dateLabel?: string;
    priceMasked: boolean;
    /** "$1,625,000" — consumers only; never present on an anonymous payload. */
    priceLabel?: string;
    /** Destination the SERVER resolved for the record — already forwards to a relist. */
    href?: string;
    /** Public status kind (audit R24a) — drives the chip's label AND colour. */
    kind?: AddressRecordResponse["dealKind"];
    /** SOLD / LEASED / OFF MARKET — the public status kind (audit R24a). */
    kindLabel?: string;
    /** Relist: this address is live right now (see AddressRecordResponse.liveKey). */
    liveKey?: string;
    livePrice?: number;
    liveTransactionType?: string;
    /** MLS# — public, shown to anon (the doc id / listing key). */
    mls?: string;
    /** Listing brokerage — public (TRREB §6.3(c)); shown to anon. */
    brokerage?: string;
  };
  /** School metadata. */
  school?: { id: string; score?: number };
}

/** One disposition (campaign) at a typed address for the multi-state dropdown. Public fields
 *  (status kind, address, MLS#, brokerage) reach anon; the VOW fields only a consumer. */
export interface AddressRecordResponse {
  key: string;
  address: string;
  city: string;
  /** Feed CityRegion ("Dundas" under City "Hamilton") — the finer-grained name. Present so
   *  a place row can be labelled from the FEED rather than the geocoder's own municipal
   *  naming, which would mint a second identity for one home. See searchRows.ts. */
  cityRegion?: string;
  /** Public status kind — shown to anon too (same signal /address shows, R24a). */
  dealKind: "sold" | "leased" | "offmarket";
  /** Listing brokerage — public (TRREB §6.3(c)). */
  brokerage?: string;
  href: string;
  /**
   * Relist join (public). MLS# of a listing that is LIVE right now at this same address —
   * a terminated campaign and its relist share nothing but the address, so without this
   * the record is a dead end. An active listing key + asking price are IDX data, so both
   * reach anonymous viewers.
   */
  liveKey?: string;
  livePrice?: number;
  /** "For Sale" / "For Lease" of the live campaign — a relisted lease isn't a sale. */
  liveTransactionType?: string;
  /** VOW fields — present ONLY on a signed-in consumer's response. */
  closePrice?: number;
  /** Epoch ms (UTC-midnight date-only) — render with timeZone:'UTC' (MEDIUM-18). */
  soldDateMs?: number;
  beds?: number;
  baths?: number;
  subType?: string;
}

/**
 * /api/search/address-status response — the dropdown's sold-record probe.
 * `records` carries ALL dispositions at the typed address (HouseSigma-style, newest-first).
 * The flat primary-record fields mirror records[0] and are kept for the header bar's simpler
 * kind-aware label (LocationSearch.tsx), which only needs found/address/dealKind.
 */
export interface AddressStatusResponse {
  found: boolean;
  /** All dispositions at the address, newest-first — the multi-state dropdown reads this. */
  records?: AddressRecordResponse[];
  // ── flat primary (= records[0]) for the header bar's kind-aware label ──
  key?: string;
  address?: string;
  city?: string;
  dealKind?: "sold" | "leased" | "offmarket";
  brokerage?: string;
  href?: string;
  closePrice?: number;
  soldDateMs?: number;
  beds?: number;
  baths?: number;
  subType?: string;
}

/**
 * A rendered section. Grouped by what results ARE (a place vs a listing), never by what
 * state they're in — status rides on each row instead (see searchRows.ts). `category`
 * stays on the ITEM and keeps deciding what a click does.
 */
export interface SuggestGroup {
  section: SearchSection;
  title: string;
  items: SuggestItem[];
  /** Section can carry VOW-gated figures → the dropdown shows the VOW marker. */
  vow?: boolean;
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
