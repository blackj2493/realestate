"use client";

/**
 * Client wrappers that keep the listing page's Deal Score header chip and mobile
 * hero-scent grade LOCKED to the same active lens as the Deal Score panel.
 *
 * The chip used to render the server-resolved lens and never move, while the panel
 * followed its own tab state — so the header could read "Deal Score 91 A+" while the
 * panel showed 92 for a different lens on the same screen. Both now start on the same
 * effectiveDealPersona and follow the shared lens-change broadcast (lensPersistence),
 * so switching a tab in the panel moves the chip (and hero grade) with it.
 */
import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { DealScoreBadge } from "@/components/Property/DealScoreCard";
import { onLensChanged } from "@/lib/personas/lensPersistence";
import { effectiveDealPersona, scoredDealPersonas } from "@/lib/dealScore/effectivePersona";
import type { DealPersona, DealScoreResult } from "@/lib/dealScore/computeDealScore";

/** The active Deal Score lens: the initial resolved lens, then whatever the panel
 *  switches to (ignoring lenses this listing didn't score). */
function useActiveDealPersona(
  dealScore: DealScoreResult,
  initialLens: DealPersona
): DealPersona | undefined {
  const scored = useMemo(() => scoredDealPersonas(dealScore), [dealScore]);
  const [persona, setPersona] = useState<DealPersona | undefined>(() =>
    effectiveDealPersona(dealScore, initialLens)
  );
  useEffect(
    () => onLensChanged((p) => setPersona((cur) => (scored.includes(p) ? p : cur))),
    [scored]
  );
  return persona;
}

/** Header chip — Deal Score for the active lens, mirroring the panel's tab. */
export function LiveDealScoreBadge({
  dealScore,
  initialLens,
  className,
}: {
  dealScore: DealScoreResult;
  initialLens: DealPersona;
  className?: string;
}) {
  const persona = useActiveDealPersona(dealScore, initialLens);
  const active = persona ? dealScore.personaScores?.[persona] : undefined;
  return (
    <DealScoreBadge
      score={active?.score ?? dealScore.score}
      grade={active?.grade ?? dealScore.grade}
      className={className}
    />
  );
}

/** Mobile hero-scent grade — the letter grade for the active lens, or a lock for anon. */
export function LiveDealGrade({
  dealScore,
  initialLens,
  locked = false,
}: {
  dealScore: DealScoreResult;
  initialLens: DealPersona;
  /** VOW gate: anon sees the lock, never a grade. */
  locked?: boolean;
}) {
  const persona = useActiveDealPersona(dealScore, initialLens);
  const grade = persona ? dealScore.personaScores?.[persona]?.grade ?? dealScore.grade : dealScore.grade;
  if (locked || !grade) {
    return <Lock className="h-3 w-3 text-muted-foreground" aria-label="locked" />;
  }
  return <span className="font-mono font-bold text-cyan-700 dark:text-cyan-300">{grade}</span>;
}
