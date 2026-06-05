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
