/**
 * Deal Score from a Typesense ListingDocument — the lightweight path used by the
 * Command Center list/map and the comparison grid, where we have the search index but
 * not the full Supabase payload.
 *
 * Same engine, same constants as the detail page (one source of truth).
 *
 * THE INPUTS ARE THE WHOLE PROBLEM. This path used to be called with no estimate at all,
 * so the PRICE pillar — price vs comparable sales — was simply absent, and
 * `blendForPersona` renormalized its weight onto whatever remained. That does not make the
 * score cautious, it makes it WRONG in a specific direction: for the Homebuyer lens
 * (price 0.55 / terms 0.45, yield and upside 0) dropping PRICE leaves TERMS carrying 100%,
 * so the headline became a pure price-cut-and-days-on-market score. 118 Village Gate
 * Drive graded A+ 95 in the ledger and 38 D on its own page, and the MIN DEAL GRADE
 * filter — which runs through this same function — surfaced it under a "≥ A" floor.
 *
 * So callers now pass the SAME three values getListingDetail feeds computeDealScore
 * (raw AVM + confidence, expected close, cohort ratio), fetched together by
 * /api/estimates/sale-price which already derived all three.
 */

import { computeDealScore, PERSONA_WEIGHTS, type DealScoreResult, type DealPersona } from "./computeDealScore";
import type { ListingDocument } from "@/lib/typesense/client";
import { capRateOrNull } from "@/lib/metrics/sanityBand";

/**
 * The VOW-derived scoring inputs for one listing, as returned by
 * /api/estimates/sale-price. Every field is nullable: the AVM is a nightly precompute
 * covering ~94% of the active book, and anonymous callers get nothing at all.
 */
export interface DealInputs {
  /** Raw AVM value from property_estimates — the PRICE pillar's input. */
  estimatedValue: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  /** Cohort close/list-anchored expected close, and the ratio behind it. */
  expectedSalePrice: number | null;
  closeListRatio: number | null;
}

/** Back-compat alias — Compare passes just the AVM half. */
export interface DocumentDealScoreEstimate {
  estimatedValue: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

/**
 * Share of a persona's nominal weight that PRICE carries. At or above this, a missing
 * PRICE pillar means the remaining signals cannot honestly stand in for a headline grade,
 * so we withhold rather than publish a renormalized one.
 *
 * Calibrated to the weight matrix rather than picked: only `smart` (0.55 of 1.00) clears
 * it. cashflow (0.25, yield-led) and builders (0.35, upside-led) still say something real
 * without the AVM; flippers sits just under at 0.45 and keeps scoring.
 */
const PRICE_DOMINANCE_THRESHOLD = 0.5;

/** True when PRICE carries at least half of this persona's nominal weight. */
function priceIsDominant(persona: DealPersona): boolean {
  const w = PERSONA_WEIGHTS[persona];
  const total = w.price + w.terms + w.yield + w.upside;
  return total > 0 && w.price / total >= PRICE_DOMINANCE_THRESHOLD;
}

/**
 * @param inputs the VOW-derived scoring inputs. Omit (or pass null) only where they are
 *   genuinely unavailable — anonymous callers, or a listing with no precomputed estimate.
 *   Passing nothing no longer yields a quietly-inflated grade; see PRICE_DOMINANCE_THRESHOLD.
 * @param persona which lens the headline score is for — pass the Command Center's
 *   activePersona so a list/map grade matches what the detail card opens on.
 */
export function dealScoreFromDocument(
  doc: ListingDocument,
  inputs?: DealInputs | DocumentDealScoreEstimate | null,
  persona: DealPersona = "smart"
): DealScoreResult {
  const dom = doc.TrueDom ?? doc.calculatedDOM ?? doc.DaysOnMarket;
  const capRate = capRateOrNull(doc.cap_rate_est);

  const estimatedValue = inputs?.estimatedValue ?? null;
  const confidence = inputs?.confidence ?? null;
  const hasPrice = typeof estimatedValue === "number" && estimatedValue > 0 && confidence != null;

  // Withhold rather than renormalize. `listPrice: null` is the engine's canonical
  // "nothing to score" result (score/grade null), which passesDealGrade already treats as
  // failing any floor — so a "≥ A" filter excludes these instead of collecting them.
  if (!hasPrice && priceIsDominant(persona)) {
    return computeDealScore({ listPrice: null }, persona);
  }

  const rich = inputs && "expectedSalePrice" in inputs ? inputs : null;

  return computeDealScore(
    {
      listPrice: doc.ListPrice ?? null,
      originalListPrice: doc.OriginalListPrice ?? null,
      avmEstimate: hasPrice ? { estimatedValue: estimatedValue as number, confidence: confidence! } : null,
      domDays: typeof dom === "number" ? dom : null,
      capRatePct: capRate,
      // Selects the asset-class yield baseline (so the cashflow lens scores cap rate
      // relative to this property type, not one absolute curve).
      subType: doc.PropertySubType ?? null,
      // The two signals the detail page also passes; without them the terminal's TERMS
      // pillar was scoring on strictly less evidence than the page it links to.
      expectedSalePrice: rich?.expectedSalePrice ?? null,
      closeListRatio: rich?.closeListRatio ?? null,
    },
    persona
  );
}
