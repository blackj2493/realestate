/**
 * Deal Score from a Typesense ListingDocument — the lightweight path used by the
 * Command Center list and the comparison grid, where we have the search index but
 * not the full Supabase payload.
 *
 * Same engine, same constants as the detail page (one source of truth). When a
 * precomputed AVM estimate is supplied (Compare reads it from property_estimates),
 * the "Value vs Estimate" component is included too — so the comparison Deal Score
 * matches the detail page exactly. Without it, that component is omitted and the
 * remaining signals renormalize automatically (Command Center list behaviour).
 */

import { computeDealScore, type DealScoreResult, type DealPersona } from "./computeDealScore";
import type { ListingDocument } from "@/lib/typesense/client";
import { capRateOrNull } from "@/lib/metrics/sanityBand";

export interface DocumentDealScoreEstimate {
  estimatedValue: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

/**
 * @param persona which lens the headline score is for — pass the Command Center's
 *   activePersona so a list/map grade matches what the detail card opens on. Defaults
 *   to "smart" (the app default Homebuyer lens). Note: the Homebuyer lens excludes the
 *   Yield pillar by design, so `.components` only contains "yield" for yield-weighting
 *   lenses (cashflow/flippers).
 */
export function dealScoreFromDocument(
  doc: ListingDocument,
  estimate?: DocumentDealScoreEstimate | null,
  persona: DealPersona = "smart"
): DealScoreResult {
  const dom = doc.TrueDom ?? doc.calculatedDOM ?? doc.DaysOnMarket;
  const capRate = capRateOrNull(doc.cap_rate_est);

  return computeDealScore(
    {
      listPrice: doc.ListPrice ?? null,
      originalListPrice: doc.OriginalListPrice ?? null,
      avmEstimate:
        estimate && estimate.estimatedValue > 0
          ? { estimatedValue: estimate.estimatedValue, confidence: estimate.confidence }
          : null,
      domDays: typeof dom === "number" ? dom : null,
      capRatePct: capRate,
      // Selects the asset-class yield baseline (so the cashflow lens scores cap rate
      // relative to this property type, not one absolute curve).
      subType: doc.PropertySubType ?? null,
    },
    persona
  );
}
