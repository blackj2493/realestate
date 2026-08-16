/**
 * Superseded de-listed comps — pure selection logic.
 *
 * THE BUG THIS FIXES
 * A terminate-then-relist resale closes under a NEW MLS#. The ORIGINAL key's
 * de-listed doc keeps its own 90-day slot in `sold_listings` (pruned on age
 * alone — see delistedIndexer.pruneOldDelisted), so the property stays lit on the
 * terminal's De-listed layer for weeks after it actually sold. Clicking that pin
 * opens /properties/<original key>, where getListingDetail's relist reconciliation
 * promotes the page to SOLD from the address-stitched campaign history — so the
 * map says "off market, approach the owner" while the page says "sold last month".
 * Measured 2026-08-03: 7,103 of 59,730 For-Sale de-listed pins (11.9%) had
 * already closed. Example: 210 Charlton Ave E, Hamilton — X12833514 terminated
 * 2026-06-01, relist X13220658 sold 2026-07-02 for $475,000.
 *
 * THE RULE: a de-listed comp is superseded when a SALE exists at the same address,
 * under a different listing key, dated at or after the de-list. This mirrors
 * getListingDetail's promote-to-SOLD test — both surfaces stitch by address, since
 * a close only ever reaches the original key that way — with one deliberate
 * narrowing: see SUPERSEDING_DEAL_TYPES.
 *
 * Deliberately IO-free (no typesense/supabase imports) so vitest loads it directly;
 * the Typesense reads/deletes live in scripts/worker/purgeSupersededDelisted.ts.
 */
import { isDelistedDealType } from "./dealType";

/**
 * The slim projection this logic needs from a `sold_listings` doc. Note that
 * `PurchaseContractDate` is the collection's generic EVENT slot: the sold-firm
 * date on a close, the de-list date on a de-listed row (soldListingsSchema).
 */
export interface CompEvent {
  id: string;
  DealType?: string;
  UnparsedAddress?: string;
  PurchaseContractDate?: number;
}

/**
 * Deal types whose close retires a de-listed pin — SOLD only, by product decision.
 *
 * A sale campaign that terminated and was then LEASED means the owner still owns the
 * property and still wanted to sell: a prime off-market lead, so its pin stays lit
 * (1,005 pins as measured 2026-08-03). Note this is NARROWER than the detail page,
 * which promotes such a listing to "LEASED" via latestCloseFromCampaigns — so map and
 * page still read differently for that slice. Adding "leased" here closes that gap at
 * the cost of those leads; it is the only change required.
 */
export const SUPERSEDING_DEAL_TYPES = ["sold"] as const;

export function isSupersedingDealType(v: unknown): v is "sold" {
  return v === "sold";
}

/**
 * Join key for "same property".
 *
 * Typesense's `UnparsedAddress:=` is a CASE-INSENSITIVE whole-field match (probe-
 * verified 2026-08-03: it is unit-precise and order-sensitive — "455 Charlton
 * Avenue E 602" never matches unit 301, and a token subset matches nothing). The
 * inline purge leans on that operator, so this in-memory key must lowercase too
 * or the sweep would under-purge relative to it: 68 of the 7,103 measured pairs
 * differ ONLY in feed casing ("23 OTTAWA Street S" vs "23 Ottawa Street S").
 */
export function addressKey(address: string | undefined | null): string {
  return (address ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Newest superseding close per address key — only rows carrying an address and a date. */
export function indexClosesByAddress(closes: CompEvent[]): Map<string, CompEvent> {
  const byAddress = new Map<string, CompEvent>();
  for (const close of closes) {
    if (!isSupersedingDealType(close.DealType)) continue;
    const key = addressKey(close.UnparsedAddress);
    if (!key) continue;
    const at = close.PurchaseContractDate;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    const previous = byAddress.get(key);
    if (!previous || at > (previous.PurchaseContractDate as number)) byAddress.set(key, close);
  }
  return byAddress;
}

export interface SupersededMatch {
  /** The de-listed doc id to drop from `sold_listings`. */
  delistedId: string;
  /** The close that superseded it (for the audit line). */
  closeId: string;
  delistedAt: number;
  closedAt: number;
  address: string;
}

/**
 * Which de-listed comps have been superseded by a sale at the same address.
 *
 * Skips de-listed rows with no address (nothing safe to join on) and rows whose
 * only "close" is themselves. A de-list dated AFTER the newest sale is left
 * alone — that is a fresh campaign that failed post-sale, genuinely off-market.
 */
export function selectSupersededDelisted(
  delisted: CompEvent[],
  closes: CompEvent[]
): SupersededMatch[] {
  const byAddress = indexClosesByAddress(closes);
  const matches: SupersededMatch[] = [];
  for (const row of delisted) {
    if (!isDelistedDealType(row.DealType)) continue;
    if (!row.id) continue;
    const key = addressKey(row.UnparsedAddress);
    if (!key) continue;
    const delistedAt = row.PurchaseContractDate;
    if (typeof delistedAt !== "number" || !Number.isFinite(delistedAt)) continue;
    const close = byAddress.get(key);
    if (!close || close.id === row.id) continue;
    const closedAt = close.PurchaseContractDate as number;
    if (closedAt < delistedAt) continue;
    matches.push({
      delistedId: row.id,
      closeId: close.id,
      delistedAt,
      closedAt,
      address: row.UnparsedAddress ?? "",
    });
  }
  return matches;
}
