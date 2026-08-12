/**
 * "Is this address on the market RIGHT NOW?" — the relist join.
 *
 * A terminated campaign and the relist that follows it are two unrelated MLS keys: the
 * feed carries no shared identifier, so the only thing tying them together is the
 * address. Without this join an OFF MARKET record is a dead end — the search dropdown
 * sends you to a cancelled campaign while the very same home sits live under a new key
 * (90 Osler Drive, Hamilton: X12888728 off-market vs X13585448 asking $599,900 —
 * owner, 2026-08-10).
 *
 * Reads the PUBLIC active `properties` collection with the search-only key. An active
 * listing's key and asking price are IDX data already rendered to anonymous visitors on
 * every listing card, so nothing here is VOW-gated and this stays safe to call on the
 * anonymous branch of /api/search/address-status.
 */

import { getTypesenseClient, type ListingDocument } from "@/lib/typesense/client";
import { parseAddress } from "@/lib/watchlist/disposition";
import { isSamePropertyParsed } from "./sameProperty";
import { anyTransactionPriceFloor } from "@/lib/filters/fundamentals";

/** A live listing standing at the same address as a closed/off-market record. */
export interface ActiveAtAddress {
  /** MLS# of the live campaign. */
  key: string;
  address: string;
  /** Asking price (public IDX). 0 when the doc carries none. */
  listPrice: number;
  /** "For Sale" / "For Lease" — a relisted LEASE must never read as a sale. */
  transactionType: string;
}

// Only what the row needs; keeps the response small on a per-record fan-out.
const FIELDS = "id,UnparsedAddress,City,ListPrice,TransactionType";

/**
 * The live listing at `address`, or null when the home isn't currently listed.
 *
 * Matching is STRICT (`isSameProperty`), deliberately unlike the typeahead's prefix-tolerant
 * matcher. This drives navigation: a loose join here would walk someone from one home's
 * record onto a different house's listing.
 *
 * @param address    the record's own fully-qualified address (never the typed query —
 *                   "90 osler" carries no city or postal, so nothing could match it).
 * @param excludeKey the record's key, so a row can never resolve to itself.
 */
export async function findActiveAtAddress(address: string, excludeKey?: string): Promise<ActiveAtAddress | null> {
  const parsed = parseAddress(address);
  if (!parsed.streetNumber || parsed.streetName.length < 3) return null;
  try {
    const res = await getTypesenseClient()
      .collections("properties")
      .documents()
      .search({
        q: `${parsed.streetNumber} ${parsed.streetName}`.trim(),
        query_by: "UnparsedAddress",
        // Same placeholder-price floor the suggest paths use, so "live" here means the
        // same set of listings the search bar would have shown.
        filter_by: anyTransactionPriceFloor(),
        include_fields: FIELDS,
        per_page: 10,
      });
    for (const h of (res.hits ?? []) as Array<{ document: ListingDocument }>) {
      const d = h.document;
      if (!d?.id || !d.UnparsedAddress || d.id === excludeKey) continue;
      if (!isSamePropertyParsed(parsed, parseAddress(d.UnparsedAddress))) continue;
      return {
        key: d.id,
        address: d.UnparsedAddress,
        listPrice: typeof d.ListPrice === "number" ? d.ListPrice : 0,
        transactionType: d.TransactionType ?? "",
      };
    }
    return null;
  } catch (err) {
    // Best-effort: a failed join just means the record keeps its own destination.
    console.error("[activeAtAddress] live-listing lookup failed:", err);
    return null;
  }
}
