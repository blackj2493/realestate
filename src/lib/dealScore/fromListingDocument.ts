/**
 * Deal Score from a Typesense ListingDocument — the lightweight path used by the
 * Command Center list and the comparison grid, where we have the search index but
 * not the full Supabase payload / AVM.
 *
 * Same engine, same constants as the detail page (one source of truth). The only
 * difference: the AVM "Value vs Estimate" component is omitted (the estimate isn't
 * in the index), and the remaining components renormalize automatically — so list
 * scores stay consistent with the detail page's non-AVM signals.
 */

import { computeDealScore, type DealScoreResult } from "./computeDealScore";
import type { ListingDocument } from "@/lib/typesense/client";

export function dealScoreFromDocument(doc: ListingDocument): DealScoreResult {
  const dom = doc.TrueDom ?? doc.calculatedDOM ?? doc.DaysOnMarket;
  const capRate = doc.ExtrapolatedCapRate ?? doc.cap_rate_est;

  return computeDealScore({
    listPrice: doc.ListPrice ?? null,
    originalListPrice: doc.OriginalListPrice ?? null,
    avmEstimate: null,
    domDays: typeof dom === "number" ? dom : null,
    capRatePct: typeof capRate === "number" ? capRate : null,
  });
}
