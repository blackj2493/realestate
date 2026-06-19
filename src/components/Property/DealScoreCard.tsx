"use client";

import { useState } from "react";
import { ChevronDown, TrendingUp, TrendingDown, Minus, Gauge } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import type {
  DealScoreResult,
  DealScoreGrade,
  DealScoreComponent,
} from "@/lib/dealScore/computeDealScore";
import VowGateOverlay from "@/components/auth/VowGateOverlay";

/**
 * Deal Score UI — the flagship "is this a good deal?" signal.
 *
 * `DealScoreCard` shows the score ring, grade, verdict, and an expandable
 * breakdown of every component (transparency is what makes the score feel earned).
 * `DealScoreBadge` is the compact pill for page headers and rows.
 *
 * The score is OUR deterministic metric (CLAUDE.md §4) — the disclaimer makes that
 * explicit so it is never mistaken for an MLS/TRREB figure.
 */

function gradeStyles(grade: DealScoreGrade | null): {
  text: string;
  ring: string;
  bg: string;
  border: string;
} {
  switch (grade) {
    case "A+":
    case "A":
      return { text: "text-emerald-400", ring: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/40" };
    case "B":
      return { text: "text-lime-400", ring: "text-lime-400", bg: "bg-lime-500/10", border: "border-lime-500/40" };
    case "C":
      return { text: "text-amber-400", ring: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/40" };
    case "D":
      return { text: "text-orange-400", ring: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/40" };
    case "F":
      return { text: "text-rose-400", ring: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/40" };
    default:
      return { text: "text-slate-400", ring: "text-slate-600", bg: "bg-slate-800/50", border: "border-slate-700" };
  }
}

function DirectionIcon({ direction }: { direction: DealScoreComponent["direction"] }) {
  if (direction === "up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />;
  if (direction === "down") return <TrendingDown className="h-3.5 w-3.5 text-rose-400" />;
  return <Minus className="h-3.5 w-3.5 text-slate-500" />;
}

function barColor(points: number): string {
  if (points >= 60) return "bg-emerald-500";
  if (points >= 40) return "bg-amber-500";
  return "bg-rose-500";
}

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
  const s = gradeStyles(grade);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none",
        s.bg,
        s.border,
        s.text,
        className
      )}
      title={`Deal Score ${score}/100 (grade ${grade}) — PureProperty's deterministic deal metric`}
    >
      {grade}
      <span className="text-[9px] opacity-80">{score}</span>
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
  const s = gradeStyles(grade);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs font-semibold",
        s.bg,
        s.border,
        s.text,
        className
      )}
      title={`Deal Score ${score}/100 — PureProperty's deterministic deal metric`}
    >
      <Gauge className="h-3.5 w-3.5" />
      Deal Score {score}
      <span className="rounded bg-black/30 px-1">{grade}</span>
    </span>
  );
}

export default function DealScoreCard({
  dealScore,
  locked,
}: {
  dealScore: DealScoreResult;
  /** VOW gate: the score embeds the AVM — render a blurred "Login Required" teaser for anon. */
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (locked) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-200">
          <Gauge className="h-4 w-4 text-slate-500" />
          Deal Score
        </h3>
        <div className="relative">
          <div className="flex items-center gap-4 blur-sm select-none" aria-hidden="true">
            <div className="h-[88px] w-[88px] shrink-0 rounded-full border-[7px] border-slate-700" />
            <div className="space-y-2">
              <div className="h-3 w-32 rounded bg-slate-700/50" />
              <div className="h-3 w-20 rounded bg-slate-700/40" />
            </div>
          </div>
          <VowGateOverlay message="Sign in to view the Deal Score" />
        </div>
      </div>
    );
  }

  // No component had data — render a quiet "not enough data" state instead of a 0.
  if (dealScore.score === null || dealScore.grade === null) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-200">
          <Gauge className="h-4 w-4 text-slate-500" />
          Deal Score
        </h3>
        <p className="text-xs text-slate-500">{dealScore.verdict}</p>
      </div>
    );
  }

  const s = gradeStyles(dealScore.grade);
  const R = 34;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - dealScore.score / 100);

  return (
    <div className={cn("rounded-lg border bg-slate-900/50 p-4", s.border)}>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-200">
        <Gauge className={cn("h-4 w-4", s.text)} />
        Deal Score
      </h3>

      <div className="flex items-center gap-4">
        {/* Score ring */}
        <div className="relative h-[88px] w-[88px] shrink-0">
          <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
            <circle cx="40" cy="40" r={R} fill="none" strokeWidth="7" className="text-slate-800" stroke="currentColor" />
            <circle
              cx="40"
              cy="40"
              r={R}
              fill="none"
              strokeWidth="7"
              strokeLinecap="round"
              className={s.ring}
              stroke="currentColor"
              strokeDasharray={C}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("font-mono text-2xl font-bold leading-none", s.text)}>{dealScore.score}</span>
            <span className={cn("mt-0.5 text-[11px] font-bold", s.text)}>{dealScore.grade}</span>
          </div>
        </div>

        {/* Verdict */}
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug text-slate-200">{dealScore.verdict}</p>
          <p className="mt-1 text-[11px] text-slate-500">Out of 100 · {dealScore.components.length} signals</p>
        </div>
      </div>

      {/* Expandable breakdown */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 flex w-full items-center justify-between rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800/60"
      >
        Why this score
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {dealScore.components.map((c) => (
            <div key={c.key}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <DirectionIcon direction={c.direction} />
                  {c.label}
                </span>
                <span className="font-mono text-xs text-slate-400">{Math.round(c.points)}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={cn("h-full rounded-full", barColor(c.points))}
                  style={{ width: `${Math.round(c.points)}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] leading-snug text-slate-500">
                {c.detail}
                {c.compValue ? (
                  <span className="text-slate-600"> · comp value {formatPrice(c.compValue)}</span>
                ) : null}
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[10px] leading-snug text-slate-600">
        PureProperty Deal Score — our deterministic deal metric, not an MLS/TRREB figure. For research only.
      </p>
    </div>
  );
}
