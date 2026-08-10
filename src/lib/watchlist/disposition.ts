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
  /**
   * Unit / suite / apartment, normalized for comparison ("86", "12a", "lower"); "" when
   * the address carries none.
   *
   * This is load-bearing, not decorative. Every unit in a condo or condo-townhouse block
   * shares ONE civic number and ONE postal code — 2945 Thomas St #62 and #86 differ in
   * this field and nothing else. Before it existed, matching collapsed the whole block
   * onto whichever unit was probed first, and unit 86's page rendered unit 62's sale
   * price as "this home's record".
   */
  unit: string;
  /** City, lowercased; "" when absent. */
  city: string;
  /** Canadian postal, normalized to no-space upper ("L4H3C1"); "" when absent. */
  postal: string;
}

const EMPTY_ADDRESS: ParsedAddress = { streetNumber: "", streetName: "", unit: "", city: "", postal: "" };

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
 * Street names that legitimately END in a number — "Highway 7", "Concession 5",
 * "County Road 27", "Regional Road 25". Without this guard the trailing-number rule
 * would read the ROAD number as a unit and shatter one street into many.
 */
const NUMBERED_ROAD = new Set([
  "highway", "hwy", "concession", "conc", "sideroad", "sdrd", "county", "regional",
  "route", "rr", "township", "twp",
]);

/** Words that introduce a unit ("Unit 5", "Apt 5", "Suite 5"). */
const UNIT_WORD = "unit|apt|apartment|suite|ste|penthouse|lph|ph";

/** Units that are a word rather than a number — common on TRREB lease rows. */
const NAMED_UNIT = new Set([
  "lower", "upper", "basement", "bsmt", "main", "ground", "rear", "front", "loft", "penthouse", "ph",
]);

const UNIT_ONLY_PART = new RegExp(`^(?:#\\s*[a-z0-9][a-z0-9-]*|(?:${UNIT_WORD})\\b\\.?\\s*#?\\s*[a-z0-9][a-z0-9-]*)$`, "i");
const UNIT_PART_PREFIX = new RegExp(`^(?:#\\s*|(?:${UNIT_WORD})\\b\\.?\\s*#?\\s*)`, "i");
const UNIT_KEYWORD_RE = new RegExp(`\\b(?:${UNIT_WORD})\\b\\.?\\s*#?\\s*([a-z0-9][a-z0-9-]*)`, "i");
const HASH_UNIT_RE = /#\s*([a-z0-9][a-z0-9-]*)/i;
/**
 * Ontario's "unit-first" shape: "86-2945 Thomas Street", "#1210-395 Square One Dr",
 * "Unit 4 - 19 Maxwell Street". The optional leading designator matters: without it that
 * third form matched no civic-number pattern at all and parsed to an EMPTY streetNumber,
 * which silently made the property unmatchable against every other record of itself.
 */
const DASH_UNIT_RE = new RegExp(`^\\s*(?:(?:${UNIT_WORD})\\b\\.?\\s*)?#?\\s*([a-z0-9][a-z0-9-]*?)\\s*-\\s*(\\d+[a-z]?)(?=\\s)`, "i");

/**
 * Normalize a unit for comparison. "Unit 086", "#86" and "86" are the same unit; the
 * TRREB "N/A" placeholder is NOT a unit and must normalize away, or every freehold row
 * carrying it would look unit-ful and stop matching its own relist.
 */
export function normalizeUnit(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!s || s === "na") return "";
  const m = s.match(/^0*(\d+)([a-z]*)$/); // drop leading zeros, keep a letter suffix
  return m ? `${m[1]}${m[2]}` : s;
}

/**
 * Parse a free-text address ("127 Via Toscana N/A, Vaughan, ON L4H 3C1") into the
 * components the matchers need. Best-effort: any absent component is "".
 *
 * Handles the four unit shapes the feed and our own surfaces actually produce:
 *   "2945 Thomas Street 86"      trailing bare number (TRREB UnparsedAddress)
 *   "86-2945 Thomas Street"      Ontario unit-first dash form
 *   "2945 Thomas St Unit 86"     explicit designator
 *   "2945 Thomas St, Unit 86,…"  designator in its own comma part
 */
export function parseAddress(raw: string | null | undefined): ParsedAddress {
  const s = (raw ?? "").trim();
  if (!s) return { ...EMPTY_ADDRESS };

  const postalM = s.match(POSTAL_RE);
  const postal = postalM ? postalM[0].replace(/\s+/g, "").toUpperCase() : "";

  // A comma part that is ONLY a unit designator must not be mistaken for the city —
  // "2945 Thomas St, Unit 86, Mississauga" is a real feed shape, and reading "unit 86"
  // as the city silently broke every city-leg comparison.
  let unit = "";
  const parts: string[] = [];
  for (const p of s.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!unit && UNIT_ONLY_PART.test(p)) {
      unit = p.replace(UNIT_PART_PREFIX, "");
      continue;
    }
    parts.push(p);
  }

  let streetPart = parts[0] ?? "";
  const city = (parts[1] ?? "").toLowerCase().trim();

  // 1. Unit-first dash form. Rewrite to the plain shape so the civic-number match below
  //    sees the STREET number, not the unit.
  const dashM = streetPart.match(DASH_UNIT_RE);
  if (dashM) {
    if (!unit) unit = dashM[1];
    streetPart = `${dashM[2]}${streetPart.slice(dashM[0].length)}`;
  }

  const numM = streetPart.match(/^\s*(\d+[A-Za-z]?)\b/);
  const streetNumber = numM ? numM[1].toLowerCase() : "";

  let rest = streetPart.replace(/^\s*\d+[A-Za-z]?\s*/, ""); // drop the civic number

  // 2. Explicit designators anywhere in the remainder.
  const kwM = rest.match(UNIT_KEYWORD_RE);
  if (kwM) {
    if (!unit) unit = kwM[1];
    rest = rest.replace(UNIT_KEYWORD_RE, " ");
  }
  const hashM = rest.match(HASH_UNIT_RE);
  if (hashM) {
    if (!unit) unit = hashM[1];
    rest = rest.replace(HASH_UNIT_RE, " ");
  }

  rest = rest.replace(/\bn\s*\/\s*a\b/gi, " "); // "N/A" unit placeholder — noise, not a unit

  let tokens = rest.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase().split(/\s+/).filter(Boolean);

  // 3. Trailing bare unit — the dominant TRREB shape ("2945 Thomas Street 86"). Only
  //    when the token before it is a street type or directional, so "Highway 7" and
  //    "Bloor St W" are read correctly; the NUMBERED_ROAD guard covers the rest.
  if (!unit && tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    const prev = tokens[tokens.length - 2];
    const looksLikeUnit = /^\d+[a-z]?$/.test(last) || NAMED_UNIT.has(last);
    if (looksLikeUnit && STREET_SUFFIX.has(prev) && !tokens.some((t) => NUMBERED_ROAD.has(t))) {
      unit = last;
      tokens = tokens.slice(0, -1);
    }
  }

  return { streetNumber, streetName: tokens.join(" "), unit: normalizeUnit(unit), city, postal };
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
 * Prefix-tolerant variant for TYPE-AHEAD surfaces only: every typed token must match a
 * candidate token, and the LAST typed token may match as a prefix — "via to" matches
 * "Via Toscana" mid-keystroke. Never use for canonical address resolution (a bare "to"
 * would claim Toscana, Torino and Tower Rd alike); suggestion ranking absorbs that.
 */
export function streetNamesMatchPrefix(typed: string, candidate: string): boolean {
  const ta = nameTokens(typed);
  const tb = nameTokens(candidate);
  if (!ta.length || !tb.length) return false;
  return ta.every((t, i) => (i === ta.length - 1 ? tb.some((c) => c.startsWith(t)) : tb.includes(t)));
}

/**
 * Whether two addresses name the SAME unit.
 *
 * Both known → they must be equal. Neither → a freehold pair, fine. Exactly one side
 * knows its unit → REJECT: we cannot confirm the two are the same home, and the whole
 * point of this field is that an unconfirmed match previously rendered a neighbour's
 * sale price as the subject's own. A missed relist is a blank card; a wrong match is a
 * wrong number on a page that promises real ones.
 */
export function unitsMatch(a: ParsedAddress, b: ParsedAddress): boolean {
  if (a.unit && b.unit) return a.unit === b.unit;
  return !a.unit && !b.unit;
}

/**
 * Whether two parsed addresses are the SAME physical property: same civic number, same
 * unit, same street, in the same place.
 *
 * The postal leg used to return on postal equality ALONE. That is what let every unit in
 * a condo block match every other one — they share a civic number and a postal code —
 * so the street name is now checked on both legs and the unit on neither's behalf.
 */
export function addressesMatch(
  a: ParsedAddress,
  b: ParsedAddress,
  opts?: {
    /**
     * Match the BUILDING, ignoring the unit. Legitimate only for callers reading a
     * neighbourhood-level attribute that every unit in the block shares — the reno
     * cohort resolver wants a CityRegion, and #62 and #86 are unarguably in the same
     * one. NEVER set this on a path that renders a per-home number: that is precisely
     * the collapse this field was added to stop.
     */
    ignoreUnit?: boolean;
  }
): boolean {
  if (!a.streetNumber || !b.streetNumber || a.streetNumber !== b.streetNumber) return false;
  if (!opts?.ignoreUnit && !unitsMatch(a, b)) return false;
  if (a.postal && b.postal) return a.postal === b.postal && streetNamesMatch(a.streetName, b.streetName);
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
