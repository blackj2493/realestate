/**
 * How a search result presents itself — one definition shared by both search bars.
 *
 * Two axes, deliberately separate:
 *
 *  • SECTION — what a result *is*: a place you can put the map on, or a listing you can
 *    open. Sections never encode STATE. Splitting sections by status scatters three homes
 *    on one street into three blocks and buries the map exit under a stack of headers on a
 *    phone; status belongs on the row (see ROW_STATUS_*).
 *
 *  • ROW STATUS — what state a listing is in: for sale, for lease, sold, leased, off
 *    market. Rendered as a coloured word plus a colour-matched price, so the state reads
 *    twice without extra chrome.
 *
 * The terminal bar and the header bar each used to spell this out for themselves, which is
 * how they drifted: the header showed a listing-less record as a generic "Profile" tag
 * while the terminal showed a coloured OFF MARKET chip for the same record. Anything that
 * describes how a row looks or which section it lands in belongs here.
 */

import { formatRegionParts } from "@/lib/regions/formatRegionLabel";
import type { AddressRecordResponse } from "./types";

// ── Sections ────────────────────────────────────────────────────────────────

/** A place puts the MAP somewhere; a listing opens a PAGE. */
export type SearchSection = "places" | "listings";

/** Render order. Places first: the map exit must never be below the fold. */
export const SECTION_ORDER: SearchSection[] = ["places", "listings"];

export const SECTION_TITLE: Record<SearchSection, string> = {
  places: "Places",
  listings: "Listings",
};

/**
 * Which section a suggestion belongs in, from its behavioural category.
 *
 * `category` still decides what a click DOES (the switch in each bar); this decides only
 * where the row is grouped. Keeping them separate is what lets sections change without
 * re-testing every click path.
 */
export function sectionForCategory(category: string): SearchSection {
  return category === "community" || category === "geo" || category === "school"
    ? "places"
    : "listings";
}

// ── Row status ──────────────────────────────────────────────────────────────

/** Closed/ended campaigns (from a record) plus live ones (from an active listing). */
export type RowStatus = "forsale" | "forlease" | "sold" | "leased" | "offmarket";

/** Public status kind of a record — the VOW-safe signal (audit R24a). */
export type RecordKind = AddressRecordResponse["dealKind"];

export const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  forsale: "For Sale",
  forlease: "For Lease",
  sold: "Sold",
  leased: "Leased",
  offmarket: "Off Market",
};

/**
 * Colours, theme-aware in both directions (never a bare dark-only token — a colour whose
 * only definition sits behind `dark:` renders one theme's ink on the other's ground).
 */
export const ROW_STATUS_TONE: Record<RowStatus, string> = {
  forsale: "text-emerald-700 dark:text-emerald-400",
  forlease: "text-cyan-700 dark:text-cyan-300",
  sold: "text-rose-700 dark:text-rose-300",
  leased: "text-sky-700 dark:text-sky-300",
  offmarket: "text-amber-700 dark:text-amber-300",
};

/** Bordered chip variant, for surfaces that still want a badge rather than a word. */
export const ROW_STATUS_CHIP: Record<RowStatus, string> = {
  forsale: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  forlease: "border-cyan-500/40 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  sold: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
  leased: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  offmarket: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

/** True for a rental — a lease price is a monthly rent and must never read as a sale. */
export function isLeaseTransaction(transactionType: string | null | undefined): boolean {
  return /lease|rent/i.test(transactionType ?? "");
}

/** An ACTIVE listing's row status, from the feed's own TransactionType. */
export function activeRowStatus(transactionType: string | null | undefined): RowStatus {
  return isLeaseTransaction(transactionType) ? "forlease" : "forsale";
}

// ── Figures ─────────────────────────────────────────────────────────────────

/** Epoch (UTC-midnight, date-only) → "Jul 21, 2026". Rendered in UTC — a local-time
 *  render shifts these dates back a day for every Canadian viewer (audit MEDIUM-18). */
export function formatRecordDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "$1,625,000". `perMonth` appends "/mo" so a rent never reads as a purchase price. */
export function formatRowPrice(n: number, perMonth = false): string {
  return `$${Math.round(n).toLocaleString("en-CA")}${perMonth ? "/mo" : ""}`;
}

/**
 * The "this home is listed again" line shown under a record whose address currently has a
 * live campaign. Plain language on purpose — it appears in the app header, the one search
 * surface a brand-new visitor meets before they know the terminal's vocabulary.
 */
export function backOnMarketLabel(livePrice?: number, transactionType?: string): string {
  const lease = isLeaseTransaction(transactionType);
  const verb = lease ? "For rent again" : "Back on the market";
  if (!livePrice || livePrice <= 0) return verb;
  return `${verb} — ${formatRowPrice(livePrice, lease)}`;
}

// ── Listing facts ───────────────────────────────────────────────────────────

/**
 * The subset of a listing document these helpers read. Structural on purpose — both bars
 * pass a full ListingDocument, and keeping the shape local avoids importing the whole
 * Typesense module into a presentation helper.
 */
export interface ListingFacts {
  id?: string;
  BedroomsAboveGrade?: number;
  BedroomsBelowGrade?: number;
  BedroomsTotal?: number;
  BathroomsTotalInteger?: number;
  ParkingTotal?: number;
  PropertySubType?: string;
  ListPrice?: number;
  TransactionType?: string;
  /** Epoch MILLISECONDS — the listing's entry date. */
  EntryTimestamp?: number;
  ListOfficeName?: string;
}

/**
 * Beds in the TRREB idiom: "4+1" is four above grade plus one below. We hold both counts
 * but used to render `BedroomsAboveGrade || BedroomsTotal`, which silently dropped the
 * basement bedroom — a real difference to anyone shopping for a suite.
 */
export function bedsLabel(d: ListingFacts): string | null {
  const above = d.BedroomsAboveGrade ?? 0;
  const below = d.BedroomsBelowGrade ?? 0;
  if (above > 0) return below > 0 ? `${above}+${below}` : `${above}`;
  return d.BedroomsTotal ? `${d.BedroomsTotal}` : null;
}

/** "4+1 bd · 3 ba · 2 pk · Detached · $885,000" — the row's spec line. */
export function listingSpecs(d: ListingFacts): string {
  const lease = isLeaseTransaction(d.TransactionType);
  const parts: string[] = [];
  const beds = bedsLabel(d);
  if (beds) parts.push(`${beds} bd`);
  if (d.BathroomsTotalInteger) parts.push(`${d.BathroomsTotalInteger} ba`);
  if (d.ParkingTotal) parts.push(`${d.ParkingTotal} pk`);
  if (d.PropertySubType) parts.push(d.PropertySubType.trim());
  // A lease's ListPrice is a MONTHLY RENT; bare, it reads as a purchase price.
  if (d.ListPrice) parts.push(formatRowPrice(d.ListPrice, lease));
  return parts.join(" · ");
}

/**
 * "Jun 25, 2026 · X13491562 · ROYAL LEPAGE TEAM REALTY" — provenance under a listing row.
 * The date is what actually separates several campaigns at one address; MLS# and
 * brokerage are public (TRREB §6.3(c)). Formatted in UTC like every other date we render,
 * so the day doesn't drift by viewer.
 */
export function listingMetaLine(d: ListingFacts): string | undefined {
  const date = d.EntryTimestamp && d.EntryTimestamp > 0 ? formatRecordDate(d.EntryTimestamp) : null;
  return [date, d.id, d.ListOfficeName?.trim() || null].filter(Boolean).join("  ·  ") || undefined;
}

// ── Locality naming (geocoder vs feed) ──────────────────────────────────────

/**
 * How to name a place row.
 *
 * THE RULE: the FEED owns identity, the GEOCODER owns geometry. The geocoder answers with
 * its own municipal naming — "90 Osler Drive, **Dundas**" — where the feed files the same
 * home under `City: "Hamilton", CityRegion: "Dundas"`. Neither is wrong; they name
 * different levels. But only the feed's vocabulary exists in CITY_GROUPS / region_aliases
 * / the Typesense facets, and only the feed's city is already baked into the /address URLs
 * in our sitemap — so a geocoder name used as a label or a slug mints a second identity
 * for one home.
 *
 * Hence: coordinates from the geocoder, every NAME from the feed whenever a feed row
 * exists. `localityMatch` (streetLedger.ts) is the reconciliation rule when the two must
 * be compared — never `===` on city, and never against `City` alone.
 *
 * @param city   feed City ("Hamilton")
 * @param region feed CityRegion ("Dundas") — the finer-grained name, shown first
 */
export function localityLabel(city?: string | null, region?: string | null): string {
  const c = (city ?? "").trim();
  // The raw CityRegion is a board value, not a label: Ottawa carries its numeric OREB
  // prefix ("9008 - Kanata - Morgan's Grant/South March") and Toronto an opaque district
  // code. formatRegionParts is the established display formatter for exactly this.
  const r = region ? formatRegionParts(region).name.trim() : "";
  if (!r) return c;
  if (!c) return r;
  // Same place named twice → keep the CITY's casing, the canonical top-level feed value.
  if (r.toLowerCase() === c.toLowerCase()) return c;
  // Ottawa's area names already lead with their city ("Kanata - Morgan's Grant"), so
  // appending the city again reads as a stutter.
  if (r.toLowerCase().startsWith(c.toLowerCase())) return r;
  return `${r} · ${c}`;
}
