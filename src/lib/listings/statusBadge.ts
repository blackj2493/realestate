/**
 * Maps a TRREB `Status` (MlsStatus, per transformer.ts:980) to a small badge for
 * the active-browse card. Plain-active statuses return null (the For Sale/Lease chip
 * already conveys availability). Conditional-sale / conditional-lease / dead statuses
 * leak into the active `properties` collection because they are still
 * StandardStatus=Active in the IDX feed (verified: ~2,424 "Sold Conditional" live on
 * 2026-06-03), so we surface their real status instead of hiding them.
 *
 * IDX display only — no VOW data, no close price. Tone drives the chip colour.
 */
export type BadgeTone = "warn" | "info" | "neutral";

export interface StatusBadge {
  label: string;
  tone: BadgeTone;
}

const PLAIN_ACTIVE = new Set(["new", "price change", "extension", "active", ""]);

export function statusBadge(status: string | undefined | null): StatusBadge | null {
  const s = (status ?? "").toLowerCase().trim();
  if (PLAIN_ACTIVE.has(s)) return null;
  if (s.startsWith("sold conditional")) return { label: "Sold Cond.", tone: "warn" };
  if (s.startsWith("leased conditional")) return { label: "Leased Cond.", tone: "warn" };
  if (s === "deal fell through") return { label: "Back on Market", tone: "info" };
  // Forward-compatible: show any other non-active status verbatim, Title-Cased.
  const label = (status ?? "").trim().replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return { label, tone: "neutral" };
}

/**
 * The listing page's line under the price for a conditional deal. The page resolves these
 * listings as "active" (they are still StandardStatus=Active in the IDX feed), so without
 * it a reader who lands from a link, an alert or a search engine sees a plain for-sale
 * home. Same prefix rule as `statusBadge`. An escape clause means the seller can still
 * take other offers, which is the one case where an offer today can still win.
 */
export function conditionalNotice(status: string | undefined | null): string | null {
  const s = (status ?? "").toLowerCase().trim();
  if (s.startsWith("sold conditional")) {
    return s.includes("escape")
      ? "Sold conditionally, with an escape clause. The seller accepted an offer with conditions, but can still take other offers."
      : "Sold conditionally. The seller accepted an offer with conditions. If the conditions are not met, the home comes back on the market.";
  }
  if (s.startsWith("leased conditional")) {
    return s.includes("escape")
      ? "Leased conditionally, with an escape clause. The landlord accepted an offer with conditions, but can still take other offers."
      : "Leased conditionally. The landlord accepted an offer with conditions. If the conditions are not met, the home comes back on the market.";
  }
  return null;
}
