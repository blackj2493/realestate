/**
 * listingStatus — pure status resolution + sold-accuracy picker for the listing
 * detail page (spec: docs/superpowers/specs/2026-06-11-status-aware-listing-design.md).
 *
 * Why a `raw_vow_delisted` row is part of the input: Query B (sold) upserts the
 * updated payload into `listings`, but Query C (Terminated/Expired/Suspended) only
 * writes `raw_vow_delisted` — the `listings` row stays frozen looking Active, so
 * the archive lookup is the ONLY truth source for the de-listed state.
 *
 * Deliberately IO-free and import-light (no getListingDetail import → no cycle;
 * unit-testable in the node-env vitest setup).
 */

/** Slim projection of a raw_vow_delisted row (see scripts/worker/delistedIndexer.ts). */
export interface DelistedRowLite {
  mls_status: string | null;
  delisted_date: string | null;
  days_on_market: number | null;
  list_price: number | null;
}

export interface SoldStatus {
  kind: "sold";
  label: "SOLD" | "LEASED";
  /** VOW-gated. Null when not disclosed (DoNotDiscloseUntilClosingYN) or for anon. */
  closePrice: number | null;
  soldDate: string | null;
}

export interface DelistedStatus {
  kind: "delisted";
  /** "Terminated" | "Expired" | "Suspended" — VOW-gated (null for anon). */
  mlsStatus: string | null;
  delistedDate: string | null;
  daysOnMarket: number | null;
  lastListPrice: number | null;
}

export interface ActiveStatus {
  kind: "active";
}

/**
 * The feed STOPPED SERVING this listing and never said why.
 *
 * Distinct from `delisted` on purpose. Terminated/Expired/Suspended are things TRREB
 * TOLD us; this is the absence of any statement at all. Every sync query is a forward
 * cursor that only reacts to a record the feed hands back, so a listing that quietly
 * leaves produces no sold record, no de-list record and no status change — its
 * `listings` row simply freezes reading Active forever.
 *
 * E13415990 (70 Silver Star Blvd #121, a Commercial Retail lease) is the case this was
 * built for: last served 2026-06-08, and 79 days later the page still said "available",
 * because "we have not heard about this in months" was not something the model could say.
 *
 * It deliberately does NOT claim the listing sold or leased. Checked 2026-08-27: we hold
 * no close and no de-list record for it — none at that address at all. Printing "LEASED"
 * would publish a transaction the feed never sent us, which on a VOW/IDX feed is a
 * compliance problem, not merely a wrong label. Where the feed DID tell us, the `sold`
 * and `delisted` branches already say so and they win.
 */
export interface UnavailableStatus {
  kind: "unavailable";
  /** Last date the feed served this listing as Active. VOW-gated (null for anon). */
  lastSeen: string | null;
}

export type ListingStatus =
  | ActiveStatus
  | SoldStatus
  | DelistedStatus
  | UnavailableStatus;

/** ghostReconcile's per-key verdict on a listing's absence from the feed. */
export interface FeedAbsence {
  /** `listings.is_orphaned` — the feed no longer serves this key, verified per key. */
  orphaned: boolean;
  /**
   * Last date the feed was OBSERVED serving this listing — null unless that is actually
   * known. Do NOT pass `listings.last_seen_at` straight in: the column defaults to now()
   * at insert and only ghostReconcile's heartbeat ever moves it, so on an unstamped row it
   * is the creation date, and the page renders it as the day the board stopped providing
   * the listing. See the caller in getListingDetail for the stamped-vs-default test.
   */
  lastSeen: string | null;
}

export function resolveListingStatus(
  payload: Record<string, unknown>,
  delistedRow: DelistedRowLite | null,
  absence?: FeedAbsence | null
): ListingStatus {
  const std = String(payload["StandardStatus"] ?? "").toLowerCase().trim();
  const mls = String(payload["MlsStatus"] ?? "").toLowerCase().trim();

  if (std === "closed" || mls === "sold" || mls === "leased") {
    const tx = String(payload["TransactionType"] ?? "").toLowerCase();
    const label: SoldStatus["label"] =
      mls === "leased" || tx.startsWith("for lease") ? "LEASED" : "SOLD";
    const cp = payload["ClosePrice"];
    const closePrice = typeof cp === "number" && cp > 0 ? cp : null;
    // Sold date = the firm/contract date (PurchaseContractDate), NOT CloseDate.
    // CloseDate is the future possession/completion date — for a firm-but-not-yet-
    // closed sale it can be months ahead (e.g. "SOLD Jul 2026" while still June),
    // and it disagrees with the map surface (soldMapper uses PurchaseContractDate).
    // Fall back to CloseDate only when the contract date is absent.
    const cd = payload["PurchaseContractDate"] ?? payload["CloseDate"];
    const soldDate = typeof cd === "string" && cd ? cd : null;
    return { kind: "sold", label, closePrice, soldDate };
  }

  if (delistedRow) {
    return {
      kind: "delisted",
      mlsStatus: delistedRow.mls_status ?? null,
      delistedDate: delistedRow.delisted_date ?? null,
      daysOnMarket: delistedRow.days_on_market ?? null,
      lastListPrice: delistedRow.list_price ?? null,
    };
  }

  // LAST, never first: a stated outcome always beats an inferred one. A listing can be
  // both closed and absent from the feed, and "SOLD" is the better answer every time.
  if (absence?.orphaned) {
    return { kind: "unavailable", lastSeen: absence.lastSeen ?? null };
  }

  return { kind: "active" };
}

/** Minimal sale-event shape (structural subset of getListingDetail's SaleEvent — no import cycle). */
export interface SaleEventLite {
  listing_key: string;
  close_price: number | null;
  close_date: string | null;
}

/**
 * Non-disclosure fallback: a Closed payload may carry ClosePrice=0
 * (DoNotDiscloseUntilClosingYN). property_sale_history sometimes has the figure once
 * the deal closes — but ONLY this listing's own event is trustworthy; a prior
 * campaign's sale price would corrupt the accuracy math.
 */
export function fillClosePriceFromSaleHistory(
  status: ListingStatus,
  listingKey: string,
  saleEvents: SaleEventLite[]
): ListingStatus {
  if (status.kind !== "sold" || status.closePrice !== null) return status;
  const own = saleEvents.find(
    (e) => e.listing_key === listingKey && (e.close_price ?? 0) > 0
  );
  if (!own) return status;
  return {
    ...status,
    closePrice: own.close_price,
    soldDate: status.soldDate ?? own.close_date,
  };
}

/** The accuracy receipt: how close our closest model came to the actual sale. */
export interface SoldAccuracy {
  modelLabel: "Expected Sale Price" | "Comparable Sales";
  estimateValue: number;
  closePrice: number;
  /** Signed: (estimate − close) / close. Positive ⇒ we over-called. */
  diffPct: number;
}

/**
 * Compare the close against both models and keep ONLY the closest (user decision:
 * showing the list-blind AVM's ~11% delta alongside would hurt credibility).
 * Ties go to Expected Sale Price (listed first).
 */
export function pickSoldAccuracy(args: {
  closePrice: number | null;
  avmValue: number | null;
  expectedSalePrice: number | null;
}): SoldAccuracy | null {
  const { closePrice, avmValue, expectedSalePrice } = args;
  if (!closePrice || closePrice <= 0) return null;

  const candidates: Array<{ modelLabel: SoldAccuracy["modelLabel"]; value: number }> = [];
  if (expectedSalePrice && expectedSalePrice > 0)
    candidates.push({ modelLabel: "Expected Sale Price", value: expectedSalePrice });
  if (avmValue && avmValue > 0)
    candidates.push({ modelLabel: "Comparable Sales", value: avmValue });
  if (candidates.length === 0) return null;

  const best = candidates.reduce((a, b) =>
    Math.abs(b.value - closePrice) < Math.abs(a.value - closePrice) ? b : a
  );
  return {
    modelLabel: best.modelLabel,
    estimateValue: best.value,
    closePrice,
    diffPct: (best.value - closePrice) / closePrice,
  };
}

/**
 * VOW gating (CLAUDE.md §4): the status KIND is public (anon sees the SOLD /
 * OFF MARKET badge — HouseSigma model; the badge itself is the conversion hook),
 * but every VOW-sourced number/date is stripped. Called from gateVowDerived so
 * one call fully de-VOWs a ListingDetail.
 */
export function gateListingStatus(status: ListingStatus, isAuthed: boolean): ListingStatus {
  if (isAuthed) return status;
  if (status.kind === "sold")
    return { kind: "sold", label: status.label, closePrice: null, soldDate: null };
  if (status.kind === "delisted")
    return {
      kind: "delisted",
      mlsStatus: null,
      delistedDate: null,
      daysOnMarket: null,
      lastListPrice: null,
    };
  // The KIND is public (anon sees the badge), but lastSeen is a feed-derived date and
  // dates are stripped for anon everywhere else in this function — keep it consistent.
  if (status.kind === "unavailable") return { kind: "unavailable", lastSeen: null };
  return status;
}
