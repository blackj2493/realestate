/**
 * Shared "which Deal Score lens is showing" resolution.
 *
 * Used by DealScoreCard, the listing-page header Deal Score chip (LiveDealScoreBadge)
 * and the mobile hero-scent grade (LiveDealGrade) so a listing can NEVER show two
 * different scores on one screen. The header chip used to render the server-resolved
 * lens and never move while the panel followed its own tab state — so the header could
 * read "Deal Score 91 A+" while the panel showed 92 for a different lens on the same
 * screen. Every surface now starts on the SAME effective persona (this helper) and
 * follows the same lens-change broadcast (lensPersistence).
 */
import type { DealPersona, DealScoreResult } from "./computeDealScore";

/** Canonical persona order (mirrors personaConfig PERSONA_LIST). */
export const DEAL_PERSONA_ORDER: DealPersona[] = ["smart", "cashflow", "flippers", "builders"];

/** The lenses that actually produced a score for this listing (others are hidden). */
export function scoredDealPersonas(
  dealScore: Pick<DealScoreResult, "personaScores">
): DealPersona[] {
  return DEAL_PERSONA_ORDER.filter((p) => dealScore.personaScores?.[p]?.score != null);
}

/**
 * The persona whose score/grade the card + chip should display: the REQUESTED lens if
 * it scored, else the engine's own headline persona if it scored, else the first lens
 * that scored (or undefined when nothing scored). Deterministic, so every surface that
 * shows a Deal Score for this listing agrees on the number.
 */
export function effectiveDealPersona(
  dealScore: Pick<DealScoreResult, "personaScores" | "persona">,
  requested?: DealPersona | null
): DealPersona | undefined {
  const scored = scoredDealPersonas(dealScore);
  if (requested && scored.includes(requested)) return requested;
  if (scored.includes(dealScore.persona)) return dealScore.persona;
  return scored[0];
}
