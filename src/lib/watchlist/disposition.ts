/**
 * Watchlist disposition — what ACTUALLY happened to a saved listing once it left the
 * active index. Pure + deterministic (§4: no LLM).
 *
 * The dashboard's off-market signal (useWatchlistSnapshot) only knows the coarse fact
 * "the saved MLS key is gone from the active `properties` index." That single bucket
 * conflates three very different outcomes. This layer resolves WHY:
 *   - sold / leased   a real transaction (sold_listings.DealType).
 *   - relisted        the SAME physical address is ACTIVE again under a NEW MLS# — the
 *                     classic terminate-then-relist DOM reset. Detected by re-looking-up
 *                     the active index by address (a different active id, same address).
 *   - off-market      terminated / expired / suspended / gone (left the market, no
 *                     transaction, no live relist).
 *
 * COMPLIANCE (CLAUDE.md §4 / lib/property/listingStatus.ts gateListingStatus): only the
 * disposition KIND crosses to the client — the SOLD / OFF-MARKET badge is public
 * (HouseSigma model). VOW numbers (close price, sold date) never appear here. The
 * SPECIFIC de-list reason (Terminated/Expired/Suspended) is VOW-gated, so the route
 * collapses it to a generic off-market for non-consumers. Relist fields come from the
 * ACTIVE (public IDX) listing, so they are display-safe for everyone.
 */

import { deriveDelistedDealType, type DelistedDealType } from "@/lib/sold/dealType";

/** Why a saved listing is off the active index but did NOT transact / relist. */
export type OffMarketReason = DelistedDealType | "gone";

/** The live relist target — the new active listing for the same physical address. */
export interface RelistTarget {
  /** New active MLS key — link the saved card here. */
  newKey: string;
  /** Current ask on the new active listing (IDX, public). */
  newPrice: number | null;
  /** New listing's address (IDX, public). */
  newAddress: string | null;
  /** New listing's brokerage (ListOfficeName, IDX/public) — TRREB §6.3(c). */
  brokerage?: string | null;
}

// `brokerage` (ListOfficeName) rides on every variant so the dashboard can satisfy TRREB
// §6.3(c) on off-market cards (no live active doc). It is the listing office name, NOT a
// VOW number, so it is display-safe; the route populates it from the relist active doc or
// the sold_listings record.
export type Disposition =
  | { kind: "sold"; brokerage?: string | null }
  | { kind: "leased"; brokerage?: string | null }
  | ({ kind: "relisted" } & RelistTarget)
  | { kind: "off-market"; reason: OffMarketReason; brokerage?: string | null };

/** The exact disposition value stored in sold_listings (or null when not found there). */
export type SoldDealType = "sold" | "leased" | DelistedDealType | null;

// ────────────────────────────────────────────────────────────────────────────
// Address parsing + matching — the relist identity (number + postal | number + city).
// ────────────────────────────────────────────────────────────────────────────

export interface ParsedAddress {
  /** Leading civic number incl. an optional letter ("127", "12a"); "" when absent. */
  streetNumber: string;
  /** Street name, lowercased, unit/suffix noise stripped ("via toscana"). */
  streetName: string;
  /** City, lowercased; "" when absent. */
  city: string;
  /** Canadian postal, normalized to no-space upper ("L4H3C1"); "" when absent. */
  postal: string;
}

const POSTAL_RE = /[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d/;

/** Common street-type suffixes — dropped before street-name token comparison. */
const STREET_SUFFIX = new Set([
  "road", "rd", "street", "st", "avenue", "ave", "av", "drive", "dr", "crescent", "cres",
  "boulevard", "blvd", "court", "crt", "ct", "lane", "ln", "way", "circle", "cir", "circ",
  "place", "pl", "terrace", "terr", "ter", "trail", "trl", "gate", "gardens", "grove", "grv",
  "close", "row", "square", "sq", "heights", "hts", "hill", "park", "pkwy", "parkway", "path",
  "walk", "mews", "common", "commons", "ridge", "run", "bend", "point", "pt", "line", "n", "s",
  "e", "w", "north", "south", "east", "west",
]);

/**
 * Parse a free-text address ("127 Via Toscana N/A, Vaughan, ON L4H 3C1") into the
 * components the relist matcher needs. Best-effort: any absent component is "".
 */
export function parseAddress(raw: string | null | undefined): ParsedAddress {
  const s = (raw ?? "").trim();
  if (!s) return { streetNumber: "", streetName: "", city: "", postal: "" };

  const postalM = s.match(POSTAL_RE);
  const postal = postalM ? postalM[0].replace(/\s+/g, "").toUpperCase() : "";

  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  const streetPart = parts[0] ?? "";
  const city = (parts[1] ?? "").toLowerCase().trim();

  const numM = streetPart.match(/^\s*(\d+[A-Za-z]?)\b/);
  const streetNumber = numM ? numM[1].toLowerCase() : "";

  // Street name = the street part minus the civic number and unit noise.
  const streetName = streetPart
    .replace(/^\s*\d+[A-Za-z]?\s*/, "") // drop the leading civic number
    .replace(/\bn\s*\/\s*a\b/gi, " ") // "N/A" unit placeholder
    .replace(/\b(unit|apt|apartment|suite|ste|ph|penthouse|lower|upper|bsmt|basement|main)\b\.?\s*#?\s*[\w-]*/gi, " ")
    .replace(/#\s*[\w-]+/g, " ") // "#4"
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();

  return { streetNumber, streetName, city, postal };
}

/** Distinctive street-name tokens (suffixes + bare directionals removed). */
function nameTokens(name: string): string[] {
  return name.split(/\s+/).filter((t) => t && !STREET_SUFFIX.has(t));
}

/** Two street names refer to the same street: every distinctive token of the shorter
 *  name appears in the longer (handles "Via Toscana" vs "Via Toscana Rd"). */
export function streetNamesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  const [shorter, longer] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return shorter.every((t) => longer.has(t));
}

/**
 * Whether two parsed addresses are the SAME physical property. The civic number must
 * match; then either the postal codes agree (strongest), or — when a postal is missing
 * — the city plus the street name agree. Unit-level matching is intentionally not done
 * here: the relist re-lookup already scopes candidates to the subject's address string.
 */
export function addressesMatch(a: ParsedAddress, b: ParsedAddress): boolean {
  if (!a.streetNumber || !b.streetNumber || a.streetNumber !== b.streetNumber) return false;
  if (a.postal && b.postal) return a.postal === b.postal;
  if (a.city && b.city && a.city === b.city) return streetNamesMatch(a.streetName, b.streetName);
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Classification — sold/leased win outright; a live relist beats a de-list reason.
// ────────────────────────────────────────────────────────────────────────────

export interface ClassifyDispositionInput {
  /** Exact value from sold_listings (null when the key isn't in that collection). */
  soldDealType: SoldDealType;
  /** The live relist target, or null when no active listing matches the address. */
  relist: RelistTarget | null;
}

/**
 * Resolve the disposition.
 *  - A confirmed sale/lease is final (a closed deal is never "relisted").
 *  - Otherwise a live relist is the meaningful, actionable outcome (link the user to it),
 *    even when sold_listings recorded the prior campaign as Terminated/Expired/Suspended.
 *  - Failing both, surface the specific de-list reason, or a generic "gone".
 */
export function classifyDisposition({ soldDealType, relist }: ClassifyDispositionInput): Disposition {
  if (soldDealType === "sold") return { kind: "sold" };
  if (soldDealType === "leased") return { kind: "leased" };
  if (relist) return { kind: "relisted", ...relist };
  if (soldDealType) return { kind: "off-market", reason: soldDealType };
  return { kind: "off-market", reason: "gone" };
}

/**
 * Map a saved listing's OWN raw vault status (listings.full_payload->>MlsStatus) to a
 * confirmed transaction, or null for anything that is not a firm closed sale/lease
 * (active, price-change, Sold Conditional, a de-list, or unknown). This is the same
 * authoritative source the detail page and the nightly alert worker use — a listing the
 * feed marks "Sold"/"Leased" closed under THAT key, even when the sold campaign never
 * made it into the Typesense sold_listings collection (a sync gap that does occur:
 * terminate-then-relist-then-sold, where the sale lives only in the vault).
 */
export function vaultTransaction(mlsStatus: string | null | undefined): "sold" | "leased" | null {
  const s = (mlsStatus ?? "").trim().toLowerCase();
  if (!s || s.includes("condition")) return null; // blank, or "Sold Conditional" (not firm yet)
  if (deriveDelistedDealType(s)) return null; // terminated / expired / suspended
  if (s.includes("leas")) return "leased";
  if (s.includes("sold") || s.includes("closed")) return "sold";
  return null; // active / new / price change / extension → no disposition yet
}

/**
 * Merge the disposition signals for one saved key into a single dealType. A confirmed
 * sale/lease is FINAL and beats any de-list reason, whichever source saw it:
 *   1. the exact sold_listings record for the saved key;
 *   2. the saved key's OWN vault status (authoritative — matches the detail page); then
 *   3. a transaction recovered at the same physical address under a different MLS#.
 * Only when no transaction exists do we fall back to the specific de-list reason. This
 * stops a terminated PREDECESSOR campaign at the address from masking the sale the user
 * actually saved (the 363 Maria Antonia bug: saved the sold relist N13410488, but the
 * only sold_listings record at the address was its terminated predecessor N13135326).
 */
export function resolveDealType({
  exact,
  vault,
  addr,
}: {
  /** dealType from the saved key's exact sold_listings record (null if absent). */
  exact: SoldDealType;
  /** the saved key's own vault MlsStatus mapped via vaultTransaction (null if none). */
  vault: "sold" | "leased" | null;
  /** transaction/de-list recovered at the same address, possibly a different MLS#. */
  addr: SoldDealType;
}): SoldDealType {
  if (exact === "sold" || exact === "leased") return exact;
  if (vault) return vault;
  if (addr === "sold" || addr === "leased") return addr;
  return exact ?? addr ?? null;
}
