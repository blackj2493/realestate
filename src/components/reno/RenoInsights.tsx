'use client';

import Link from 'next/link';
import { Lock, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deriveRenoInsights, type RenoInsight } from '@/lib/reno/insights';
import type { RenoMoveDisplay } from './RenoMoveCard';

/**
 * The "secrets" strip — the heart of the marketing reframe. Instead of a data dump,
 * we surface 2–3 counter-intuitive truths pulled from the ranked moves (best-kept
 * secret / don't-be-fooled / the real lesson). Anon sees a single teaser: the payback
 * numbers are VOW-derived, so we withhold them and invite sign-in.
 */

const TONE: Record<RenoInsight['tone'], { rule: string; kicker: string }> = {
  good: { rule: 'border-l-emerald-500', kicker: 'text-emerald-700 dark:text-emerald-400' },
  watch: { rule: 'border-l-amber-500', kicker: 'text-amber-700 dark:text-amber-500' },
  neutral: { rule: 'border-l-cyan-500', kicker: 'text-cyan-700 dark:text-cyan-400' },
};

function InsightCard({ ins }: { ins: RenoInsight }) {
  const tone = TONE[ins.tone];
  const Icon = ins.icon;
  return (
    <div className={cn('rounded-xl border border-border border-l-[3px] bg-card p-4', tone.rule)}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-[18px] w-[18px] shrink-0', tone.kicker)} strokeWidth={1.75} aria-hidden />
        <span className={cn('text-[11px] font-bold uppercase tracking-wider', tone.kicker)}>{ins.kicker}</span>
      </div>
      <p className="mt-2 text-[15px] font-semibold leading-snug text-foreground">{ins.headline}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{ins.detail}</p>
    </div>
  );
}

export default function RenoInsightStrip({
  moves,
  locked,
  where,
  unlockHref,
  onUnlock,
}: {
  moves: RenoMoveDisplay[];
  locked: boolean;
  where: string;
  unlockHref: string;
  onUnlock: () => void;
}) {
  if (locked) {
    return (
      <Link
        href={unlockHref}
        onClick={onUnlock}
        className="block rounded-xl border border-cyan-600/30 border-l-[3px] border-l-cyan-500 bg-gradient-to-br from-cyan-500/[0.07] to-transparent p-4 transition-colors hover:border-cyan-500/60"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="h-[18px] w-[18px] shrink-0 text-cyan-700 dark:text-cyan-400" strokeWidth={1.75} aria-hidden />
          <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
            The part most owners miss
          </span>
        </div>
        <p className="mt-2 text-[15px] font-semibold leading-snug text-foreground">
          Some renos pay back 3×. Others quietly lose money.
        </p>
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Sign in to see exactly which moves add value in {where} — and which don’t.
        </p>
      </Link>
    );
  }

  const insights = deriveRenoInsights(moves);
  if (insights.length === 0) return null;

  return (
    <div>
      <h2 className="mb-2.5 flex items-center gap-2 text-[15px] font-bold text-foreground">
        <Lightbulb className="h-[18px] w-[18px] text-cyan-700 dark:text-cyan-400" strokeWidth={1.75} aria-hidden />
        What the sales quietly tell you
      </h2>
      <div className={cn('grid grid-cols-1 gap-3', insights.length >= 3 ? 'sm:grid-cols-3' : insights.length === 2 && 'sm:grid-cols-2')}>
        {insights.map((ins) => (
          <InsightCard key={ins.kicker + ins.headline} ins={ins} />
        ))}
      </div>
    </div>
  );
}
