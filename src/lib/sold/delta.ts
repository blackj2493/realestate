/** Close-vs-ask: how far a sold price landed over/under the (last) list price. */
export interface SoldDelta {
  deltaAbs: number; // closePrice - listPrice (signed dollars)
  deltaPct: number; // signed %, one decimal
  direction: "over" | "under" | "at";
}

export function soldVsAsk(
  closePrice: number,
  listPrice: number | null | undefined
): SoldDelta | null {
  if (!listPrice || listPrice <= 0 || !Number.isFinite(closePrice)) return null;
  const deltaAbs = closePrice - listPrice;
  const deltaPct = Math.round((deltaAbs / listPrice) * 1000) / 10;
  const direction = deltaAbs > 0 ? "over" : deltaAbs < 0 ? "under" : "at";
  return { deltaAbs, deltaPct, direction };
}
