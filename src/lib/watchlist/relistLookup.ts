/**
 * Live-relist lookup — find the ACTIVE listing for the same physical address as a dead
 * saved key (terminate-then-relist under a new MLS#). Pure Typesense querying + the
 * deterministic address matcher from disposition.ts (§4: no LLM).
 *
 * Shared by:
 *   - POST /api/watchlist/dispositions (the dashboard "Since your last visit" feed)
 *   - scripts/worker/alerts.ts (the nightly email digest's relist scan)
 * so email and in-app never disagree about what a relist is.
 */

import type { Client } from "typesense";
import {
  addressesMatch,
  parseAddress,
  type ParsedAddress,
  type RelistTarget,
} from "./disposition";

const RELIST_CANDIDATES_PER_ADDRESS = 25;

export interface RelistActiveHit {
  id: string;
  UnparsedAddress?: string;
  PostalCode?: string;
  ListPrice?: number;
  EntryTimestamp?: number;
  ListOfficeName?: string;
  Status?: string;
  primaryImageUrl?: string;
}

/** The worker also needs the new doc's status/thumb to seed the re-pointed baseline. */
export interface RelistTargetFull extends RelistTarget {
  newStatus: string | null;
  newThumb: string | null;
}

/** Parse an active doc's address, backfilling the postal from its PostalCode field. */
function parseActive(doc: RelistActiveHit): ParsedAddress {
  const p = parseAddress(doc.UnparsedAddress);
  if (!p.postal && doc.PostalCode) p.postal = String(doc.PostalCode).replace(/\s+/g, "").toUpperCase();
  return p;
}

/**
 * Find the live relist for each candidate address in ONE multi_search round-trip.
 * Returns a map keyed by listing_key → the best-matching active listing (≠ the saved
 * key), preferring an exact postal match, then the most recently listed.
 */
export async function findRelists(
  client: Client,
  candidates: Array<{ key: string; address: string | null }>
): Promise<Map<string, RelistTargetFull>> {
  const out = new Map<string, RelistTargetFull>();
  const usable = candidates
    .map((c) => ({ ...c, parsed: parseAddress(c.address) }))
    .filter((c) => c.parsed.streetNumber); // a civic number is the minimum to match on
  if (!usable.length) return out;

  const searches = usable.map((c) => ({
    collection: "properties",
    q: `${c.parsed.streetNumber} ${c.parsed.streetName}`.trim() || "*",
    query_by: "UnparsedAddress",
    include_fields:
      "id,UnparsedAddress,PostalCode,ListPrice,EntryTimestamp,ListOfficeName,Status,primaryImageUrl",
    per_page: RELIST_CANDIDATES_PER_ADDRESS,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await client.multiSearch.perform({ searches } as any);
  const results: Array<{ hits?: Array<{ document: RelistActiveHit }> }> = res?.results ?? [];

  usable.forEach((c, i) => {
    const hits = results[i]?.hits ?? [];
    let best: { doc: RelistActiveHit; exact: boolean } | null = null;
    for (const h of hits) {
      const doc = h.document;
      if (!doc?.id || doc.id === c.key) continue; // never match the dead key back to itself
      const cand = parseActive(doc);
      if (!addressesMatch(c.parsed, cand)) continue;
      const exact = !!c.parsed.postal && c.parsed.postal === cand.postal;
      if (
        !best ||
        (exact && !best.exact) ||
        (exact === best.exact && (doc.EntryTimestamp ?? 0) > (best.doc.EntryTimestamp ?? 0))
      ) {
        best = { doc, exact };
      }
    }
    if (best) {
      out.set(c.key, {
        newKey: best.doc.id,
        newPrice: typeof best.doc.ListPrice === "number" ? best.doc.ListPrice : null,
        newAddress: best.doc.UnparsedAddress ?? null,
        brokerage: best.doc.ListOfficeName ?? null,
        newStatus: best.doc.Status ?? null,
        newThumb: best.doc.primaryImageUrl ?? null,
      });
    }
  });

  return out;
}
