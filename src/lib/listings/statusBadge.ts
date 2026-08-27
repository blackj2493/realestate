/**
 * Maps a TRREB `Status` (MlsStatus, per transformer.ts:1128) to a small badge for
 * the active-browse card. Plain-active statuses return null (the For Sale/Lease chip
 * already conveys availability). Conditional-sale / conditional-lease / dead statuses
 * leak into the active `properties` collection because they are still
 * StandardStatus=Active in the IDX feed (verified: ~2,424 "Sold Conditional" live on
 * 2026-06-03), so we surface their real status instead of hiding them.
 *
 * The status VOCABULARY lives in @/lib/listings/mlsStatus and is shared with the
 * listing detail page's resolveListingStatus — the two used to classify statuses
 * independently, which is how a card could read "Sold Cond." while the page it
 * linked to rendered a plain For Sale listing.
 *
 * IDX display only — no VOW data, no close price. Tone drives the chip colour.
 */
import { classifyMlsStatus, titleCaseStatus } from "./mlsStatus";

export type BadgeTone = "warn" | "info" | "neutral";

export interface StatusBadge {
  label: string;
  tone: BadgeTone;
}

export function statusBadge(status: string | undefined | null): StatusBadge | null {
  switch (classifyMlsStatus(status)) {
    case "plain-active":
      return null;
    case "sale-conditional":
      return { label: "Sold Cond.", tone: "warn" };
    case "lease-conditional":
      return { label: "Leased Cond.", tone: "warn" };
    case "back-on-market":
      return { label: "Back on Market", tone: "info" };
    default:
      // Forward-compatible: show any other non-active status verbatim, Title-Cased.
      return { label: titleCaseStatus(status), tone: "neutral" };
  }
}
