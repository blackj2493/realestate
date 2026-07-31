/**
 * Client-side "minimum Deal Score grade" filter for the terminal (map + ledger).
 *
 * The Deal Score is computed at render from the Typesense doc — there's no indexed score
 * field — so this filter narrows the ALREADY-LOADED results, not the whole market (a
 * market-wide filter would need a precomputed, indexed, VOW-gated score; see the feasibility
 * analysis). It uses the exact same per-lens `dealScoreFromDocument(doc, undefined, persona)`
 * the ledger row shows, so a kept row always matches its visible grade pill.
 *
 * Consumer-gated at the call sites: the grade is VOW-derived (it embeds the AVM path), so the
 * filter UI + application only run for authed consumers, mirroring the grade pill.
 */
import { dealScoreFromDocument } from "./fromListingDocument";
import type { DealScoreGrade, DealPersona } from "./computeDealScore";
import type { ListingDocument } from "@/lib/typesense/client";

/** Comparable rank, best → worst (A+ highest). */
const GRADE_RANK: Record<DealScoreGrade, number> = { "A+": 5, A: 4, B: 3, C: 2, D: 1, F: 0 };

/** Min-grade choices offered in the UI (coarse-to-fine); `null` = no floor. */
export const MIN_GRADE_OPTIONS: (DealScoreGrade | null)[] = [null, "C", "B", "A"];

/** True when `doc` grades at or above `min` for `persona`. A null floor passes everything;
 *  an unscoreable listing is excluded once a floor is set. */
export function passesDealGrade(
  doc: ListingDocument,
  persona: DealPersona,
  min: DealScoreGrade | null
): boolean {
  if (!min) return true;
  const { grade } = dealScoreFromDocument(doc, undefined, persona);
  if (grade === null) return false;
  return GRADE_RANK[grade] >= GRADE_RANK[min];
}
