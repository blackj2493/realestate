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
