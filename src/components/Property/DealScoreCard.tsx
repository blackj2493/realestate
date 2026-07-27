"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, TrendingUp, TrendingDown, Minus, Gauge, Target } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import {
  PERSONA_WEIGHTS,
  type DealScoreResult,
  type DealScoreGrade,
  type DealScoreComponent,
  type DealPersona,
} from "@/lib/dealScore/computeDealScore";
import { Redact, UnlockCta } from "@/components/Property/teaserPrimitives";
import InfoDot from "@/components/ui/InfoDot";
import { onLensChanged, persistLens } from "@/lib/personas/lensPersistence";
import { DEAL_PERSONA_ORDER, effectiveDealPersona, scoredDealPersonas } from "@/lib/dealScore/effectivePersona";

/**
 * Deal Score UI — the flagship "is this a good deal — for ME?" signal.
 *
 * `DealScoreCard` shows the score ring, grade, verdict, a per-persona LENS switcher
 * (the same property scores differently for a homebuyer vs a cashflow investor), a
 * suggested-OFFER band, and an expandable breakdown of the pillars that count for the
 * selected lens. Lens switching is fully client-side — the engine ships every persona's
 * headline + the persona-independent pillars, so no refetch is needed.
 *
 * The score is OUR deterministic metric (CLAUDE.md §4) — the disclaimer makes that
 * explicit so it is never mistaken for an MLS/TRREB figure.
 */

const PERSONA_LABEL: Record<DealPersona, string> = {
  smart: "Homebuyer",
  cashflow: "Cashflow",
  flippers: "Flipper",
  builders: "Builder",
};

function gradeStyles(grade: DealScoreGrade | null): {
  text: string;
  ring: string;
  bg: string;
  border: string;
} {
  switch (grade) {
    case "A+":
    case "A":
      return { text: "text-emerald-700 dark:text-emerald-400", ring: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/40" };
    case "B":
      return { text: "text-lime-600 dark:text-lime-400", ring: "text-lime-600 dark:text-lime-400", bg: "bg-lime-500/10", border: "border-lime-500/40" };
    case "C":
      return { text: "text-amber-700 dark:text-amber-400", ring: "text-amber-700 dark:text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/40" };
    case "D":
      return { text: "text-orange-700 dark:text-orange-400", ring: "text-orange-700 dark:text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/40" };
    case "F":
      return { text: "text-rose-700 dark:text-rose-400", ring: "text-rose-700 dark:text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/40" };
    default:
      return { text: "text-muted-foreground", ring: "text-muted-foreground", bg: "bg-muted/50", border: "border-border" };
  }
}

function DirectionIcon({ direction }: { direction: DealScoreComponent["direction"] }) {
  if (direction === "up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />;
  if (direction === "down") return <TrendingDown className="h-3.5 w-3.5 text-rose-700 dark:text-rose-400" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function barColor(points: number): string {
  if (points >= 60) return "bg-emerald-500";
  if (points >= 40) return "bg-amber-500";
  return "bg-rose-500";
}

// Deal Score is a flagship USP signal, so in LIGHT its grade chips are SOLID,
// grade-coded fills (white text) that pop; DARK keeps the original outline chip.
const GRADE_BADGE: Record<DealScoreGrade, { solid: string; darkOutline: string }> = {
  "A+": { solid: "bg-emerald-600", darkOutline: "dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/40" },
  A: { solid: "bg-emerald-600", darkOutline: "dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/40" },
  B: { solid: "bg-green-600", darkOutline: "dark:bg-lime-500/10 dark:text-lime-400 dark:border-lime-500/40" },
  C: { solid: "bg-amber-500", darkOutline: "dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/40" },
  D: { solid: "bg-orange-500", darkOutline: "dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/40" },
  F: { solid: "bg-rose-600", darkOutline: "dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/40" },
};

/**
 * Ultra-compact grade chip for tight spots (thumbnail corners, table cells).
 * Shows the letter grade + score with grade-coded color.
 */
export function DealScoreGradePill({
  score,
  grade,
  className,
}: {
  score: number | null;
  grade: DealScoreGrade | null;
  className?: string;
}) {
  if (score === null || grade === null) return null;
  const g = GRADE_BADGE[grade];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border border-transparent px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-white",
        g.solid,
        "dark:border dark:bg-transparent",
        g.darkOutline,
        className
      )}
      title={`Deal Score ${score}/100 (grade ${grade}) — PureProperty's deterministic deal metric`}
    >
      {grade}
      <span className="text-[9px] opacity-90">{score}</span>
    </span>
  );
}

/** Compact grade + score pill for headers and list rows. */
export function DealScoreBadge({
  score,
  grade,
  className,
}: {
  score: number | null;
  grade: DealScoreGrade | null;
  className?: string;
}) {
  if (score === null || grade === null) return null;
  const g = GRADE_BADGE[grade];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 font-mono text-xs font-bold shadow-sm",
        // LIGHT: solid grade fill, white text
        g.solid,
        "text-white",
        // DARK: original translucent outline chip
        "dark:border dark:bg-transparent",
        g.darkOutline,
        className
      )}
      title={`Deal Score ${score}/100 — PureProperty's deterministic deal metric`}
    >
      <Gauge className="h-3.5 w-3.5" />
      Deal Score {score}
      <span className="rounded bg-black/25 px-1 dark:bg-black/30">{grade}</span>
    </span>
  );
}

export default function DealScoreCard({
  dealScore,
  locked,
  /** Initial lens — defaults to whichever persona the engine scored (the app default). */
  initialPersona,
}: {
  dealScore: DealScoreResult;
  /** VOW gate: the score embeds the AVM — render a blurred "Login Required" teaser for anon. */
  locked?: boolean;
  initialPersona?: DealPersona;
}) {
  const [open, setOpen] = useState(false);
  // Personas that actually scored for this listing (a lens with no applicable pillars is hidden).
  const scoredPersonas = useMemo(() => scoredDealPersonas(dealScore), [dealScore]);
  // Shared with the header chip (LiveDealScoreBadge) so the two can't resolve
  // different lenses and show different scores on the same screen.
  const defaultPersona = effectiveDealPersona(dealScore, initialPersona);
  const [persona, setPersona] = useState<DealPersona | undefined>(defaultPersona);

  // Follow lens changes made in TheReadCard (persistLens broadcasts; write-through is
  // symmetric). A lens this listing didn't score keeps the current selection.
  useEffect(
    () => onLensChanged((p) => setPersona((cur) => (scoredPersonas.includes(p) ? p : cur))),
    [scoredPersonas]
  );

  if (locked) {
    // Concept B — "redacted frame": show THIS home's real card shell (the four lenses
    // and the exact signals we score) with only the number, grade and offer band
    // hidden. The ring is a NON-proportional dashed placeholder, so it can never leak
    // good-vs-bad. Nothing here reads a gated field — anon receives EMPTY_DEAL_SCORE,
    // so the frame is entirely static and no VOW value can escape (see gateVowDerived).
    const SIGNALS = [
      "Price vs comparable sales",
      "Days-on-market pace",
      "Rent coverage & carry",
      "Renovation / value-add upside",
    ];
    return (
      <div className="rounded-lg border border-cyan-500/40 bg-card p-4">
        <h3 className="mb-3 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
          <span className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            Deal Score
          </span>
          <span className="rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-medium tracking-normal text-muted-foreground">
            this home
          </span>
        </h3>

        {/* Lens switcher — the same home, scored for each investor type (grades hidden). */}
        <div className="mb-3 flex flex-wrap gap-1.5" aria-hidden="true">
          {DEAL_PERSONA_ORDER.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-2 py-1 text-[11px] font-medium text-muted-foreground"
            >
              {PERSONA_LABEL[p]}
              <Redact className="h-2.5 w-2.5 rounded-sm" />
            </span>
          ))}
        </div>

        <div className="flex items-center gap-4">
          {/* Placeholder ring — non-proportional dashed arc, redacted centre. */}
          <div className="relative h-[88px] w-[88px] shrink-0" aria-hidden="true">
            <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
              <circle cx="40" cy="40" r="34" fill="none" strokeWidth="9" className="text-muted" stroke="currentColor" />
              <circle
                cx="40"
                cy="40"
                r="34"
                fill="none"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray="3 11"
                className="text-cyan-500/50"
                stroke="currentColor"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <Redact className="h-7 w-9" />
            </div>
          </div>

          <div className="min-w-0">
            <p className="text-sm font-medium leading-snug text-foreground">
              We grade this home A–F for your buying style.
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Homebuyer and investor lenses score it differently — switch after you sign in.
            </p>
          </div>
        </div>

        {/* What we scored — real signal names, values hidden: the curiosity gap. */}
        <div className="mt-4 space-y-2.5">
          {SIGNALS.map((label) => (
            <div key={label} className="flex items-center gap-3">
              <span className="flex-1 text-[12px] text-foreground">{label}</span>
              <Redact className="h-3 w-8" />
            </div>
          ))}
        </div>

        {/* Suggested offer band — redacted. */}
        <div className="mt-3 rounded-md border border-cyan-500/30 bg-cyan-500/5 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
            <Target className="h-3.5 w-3.5" />
            Suggested move
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
            Offer
            <Redact className="h-4 w-14" />–
            <Redact className="h-4 w-14" />
          </p>
        </div>

        <UnlockCta
          label="Reveal this home's score — free"
          note="No card · about 20 seconds. PureProperty Deal Score is our deterministic metric, not an MLS/TRREB figure."
        />
      </div>
    );
  }

  const active = persona ? dealScore.personaScores?.[persona] : undefined;

  // No persona could be scored — render a quiet "not enough data" state instead of a 0.
  if (!persona || !active || active.score === null || active.grade === null) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          Deal Score
        </h3>
        <p className="text-xs text-muted-foreground">{dealScore.verdict || "Not enough data to score this listing."}</p>
      </div>
    );
  }

  const s = gradeStyles(active.grade);
  const R = 34;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - active.score / 100);

  // Pillars that count for the selected lens (points are persona-independent; weight isn't).
  const weights = PERSONA_WEIGHTS[persona];
  const lensPillars = dealScore.pillars.filter((p) => weights[p.key] > 0);
  const band = dealScore.offerBand;

  return (
    <div data-tour="listing-deal-score" className={cn("rounded-lg border bg-card p-4", s.border)}>
      <h3 className="mb-3 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
        <span className="flex items-center gap-2">
          <Gauge className={cn("h-4 w-4", s.text)} />
          Deal Score
          <InfoDot term="dealScore" />
        </span>
        {dealScore.confidence && (
          <span className="rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[9px] font-medium tracking-normal text-muted-foreground">
            {dealScore.confidence} confidence
          </span>
        )}
      </h3>

      {/* Lens switcher — the same property, scored for each investor type. */}
      {scoredPersonas.length > 1 && (
        <div role="radiogroup" aria-label="Deal Score lens" className="mb-3 flex flex-wrap gap-1.5">
          {scoredPersonas.map((p) => {
            const g = dealScore.personaScores[p];
            const ps = gradeStyles(g.grade);
            const on = p === persona;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setPersona(p);
                  persistLens(p);
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                  on ? cn(ps.bg, ps.border, ps.text) : "border-border bg-card/40 text-muted-foreground hover:bg-muted/60"
                )}
                title={`${PERSONA_LABEL[p]}: Deal Score ${g.score} (${g.grade})`}
              >
                {PERSONA_LABEL[p]}
                <span className={cn("font-mono font-bold", on ? "" : "text-muted-foreground")}>{g.grade}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-4">
        {/* Score ring */}
        <div className="relative h-[88px] w-[88px] shrink-0">
          <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
            <circle cx="40" cy="40" r={R} fill="none" strokeWidth="9" className="text-foreground dark:text-slate-800" stroke="currentColor" />
            <circle
              cx="40"
              cy="40"
              r={R}
              fill="none"
              strokeWidth="9"
              strokeLinecap="round"
              className={s.ring}
              stroke="currentColor"
              strokeDasharray={C}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("font-mono text-3xl font-extrabold leading-none", s.text)}>{active.score}</span>
            <span className={cn("mt-0.5 text-xs font-bold", s.text)}>{active.grade}</span>
          </div>
        </div>

        {/* Verdict */}
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug text-foreground">{active.verdict}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            For the {PERSONA_LABEL[persona]} lens · {lensPillars.length} signals
          </p>
        </div>
      </div>

      {/* Suggested move — the offer band (persona-independent). */}
      {band && (
        <div className="mt-3 rounded-md border border-cyan-500/30 bg-cyan-500/5 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
            <Target className="h-3.5 w-3.5" />
            Suggested move
          </p>
          {band.hotMarket ? (
            <p className="mt-1 text-sm font-medium text-foreground">
              Expect to compete near {formatPrice(band.likelyClose)}
            </p>
          ) : (
            <p className="mt-1 text-sm font-medium text-foreground">
              Offer {formatPrice(band.aggressive)}–{formatPrice(band.likelyClose)}
            </p>
          )}
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{band.note}</p>
        </div>
      )}

      {/* Expandable breakdown */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 flex w-full items-center justify-between rounded-md border border-border bg-card/40 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
      >
        Why this score
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {lensPillars.map((c) => (
            <div key={c.key}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <DirectionIcon direction={c.direction} />
                  {c.label}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{Math.round(c.points)}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", barColor(c.points))}
                  style={{ width: `${Math.round(c.points)}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {c.detail}
                {c.compValue ? (
                  <span className="text-muted-foreground"> · comp value {formatPrice(c.compValue)}</span>
                ) : null}
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
        PureProperty Deal Score — our deterministic deal metric, not an MLS/TRREB figure. Suggested
        offer is informational, not advice. For research only.
      </p>
    </div>
  );
}
