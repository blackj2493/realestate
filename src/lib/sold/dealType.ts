/**
 * Deal type for a closed VOW comp — derived from REAL board values, never price
 * (a cheap sale or a luxury rental must not be misclassified). MlsStatus is the
 * primary signal ("Leased" vs "Sold"/"Closed Sale"); TransactionType ("For Lease"/
 * "For Sale") is the fallback; default 'sold' so a blank never leaks rent into a
 * sale-price field.
 */
export type DealType = "sold" | "leased";

export function deriveDealType(
  mlsStatus: string | null | undefined,
  transactionType: string | null | undefined
): DealType {
  const mls = (mlsStatus ?? "").trim().toLowerCase();
  if (mls.includes("leas")) return "leased";
  if (mls.includes("sold") || mls.includes("sale")) return "sold";
  const tx = (transactionType ?? "").trim().toLowerCase();
  if (tx.includes("leas")) return "leased";
  return "sold";
}

/** De-list reasons — a listing that left the market WITHOUT a transaction. */
export type DelistedDealType = "terminated" | "expired" | "suspended";
/** Every comp kind the sold_listings collection can carry. */
export type CompDealType = DealType | DelistedDealType;

export const DELISTED_DEAL_TYPES: DelistedDealType[] = [
  "terminated",
  "expired",
  "suspended",
];

/**
 * Specific de-list reason from MlsStatus, or null when the status is not a
 * de-list signal (sold/leased/active/unknown). Substring match because boards
 * send variants ("Terminated", "Suspended (Temporarily)").
 */
export function deriveDelistedDealType(
  mlsStatus: string | null | undefined
): DelistedDealType | null {
  const mls = (mlsStatus ?? "").trim().toLowerCase();
  if (mls.includes("terminat")) return "terminated";
  if (mls.includes("expir")) return "expired";
  if (mls.includes("suspend")) return "suspended";
  return null;
}

export function isDelistedDealType(v: unknown): v is DelistedDealType {
  return v === "terminated" || v === "expired" || v === "suspended";
}
