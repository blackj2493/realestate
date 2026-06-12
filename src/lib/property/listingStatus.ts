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
  closeDate: string | null;
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

export type ListingStatus = ActiveStatus | SoldStatus | DelistedStatus;

export function resolveListingStatus(
  payload: Record<string, unknown>,
  delistedRow: DelistedRowLite | null
): ListingStatus {
  const std = String(payload["StandardStatus"] ?? "").toLowerCase().trim();
  const mls = String(payload["MlsStatus"] ?? "").toLowerCase().trim();

  if (std === "closed" || mls === "sold" || mls === "leased") {
    const tx = String(payload["TransactionType"] ?? "").toLowerCase();
    const label: SoldStatus["label"] =
      mls === "leased" || tx.startsWith("for lease") ? "LEASED" : "SOLD";
    const cp = payload["ClosePrice"];
    const closePrice = typeof cp === "number" && cp > 0 ? cp : null;
    const cd = payload["CloseDate"] ?? payload["PurchaseContractDate"];
    const closeDate = typeof cd === "string" && cd ? cd : null;
    return { kind: "sold", label, closePrice, closeDate };
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
    closeDate: status.closeDate ?? own.close_date,
  };
}

/** The accuracy receipt: how close our closest model came to the actual sale. */
export interface SoldAccuracy {
  modelLabel: "Expected Sale Price" | "True Value";
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
    candidates.push({ modelLabel: "True Value", value: avmValue });
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
    return { kind: "sold", label: status.label, closePrice: null, closeDate: null };
  if (status.kind === "delisted")
    return {
      kind: "delisted",
      mlsStatus: null,
      delistedDate: null,
      daysOnMarket: null,
      lastListPrice: null,
    };
  return status;
}
