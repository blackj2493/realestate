'use client';

import { Lock } from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import { moveMetaFor } from '@/lib/reno/moveMeta';

/**
 * A single renovation move — icon, name, the value it adds (or a lock for anon),
 * one quiet meta line (cost · timeline · permit · payback), and a short "why".
 * Deliberately low-chrome so a list of them reads calmly.
 */
export interface RenoMoveDisplay {
  key: string;
  rank: number;
  label: string;
  costLow: number;
  costHigh: number;
  /** VOW gate — show a lock instead of the value-add + payback. */
  locked: boolean;
  valueAddTyp?: number;
  paybackRatio?: number;
  recommended?: boolean;
}

export default function RenoMoveCard({ m }: { m: RenoMoveDisplay }) {
  const meta = moveMetaFor(m.key);
  const Icon = meta.icon;
  return (
    <div
      className={cn(
        'flex items-start gap-3.5 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-border/70',
        // The stronger-payback moves get a crisp emerald left-accent (a dull green
        // wash made the BEST options read as duller than the rest — inverted hierarchy).
        m.recommended && 'border-l-[3px] border-l-emerald-500',
      )}
    >
      <span
        className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/40 text-cyan-700 dark:text-cyan-400"
        aria-hidden
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[17px] font-semibold leading-snug text-foreground">{m.label}</span>
          <span className="shrink-0 text-right">
            {m.locked ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Lock className="h-4 w-4" aria-hidden /> payback
              </span>
            ) : (
              <span className="font-mono text-[17px] font-bold text-emerald-700 dark:text-emerald-400">
                +{formatPrice(m.valueAddTyp ?? 0)}
              </span>
            )}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted-foreground">
          <span className="font-mono">{formatPrice(m.costLow)}–{formatPrice(m.costHigh)}</span>
          <span className="text-border" aria-hidden>|</span>
          <span>{meta.timeline}</span>
          <span className="text-border" aria-hidden>|</span>
          <span className={meta.permit === 'none' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-500'}>
            {meta.permitNote}
          </span>
          {!m.locked && Number.isFinite(m.paybackRatio) && (
            <>
              <span className="text-border" aria-hidden>|</span>
              <span className="font-mono font-semibold text-foreground">{(m.paybackRatio ?? 0).toFixed(1)}× back</span>
            </>
          )}
        </div>

        <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{meta.why}</p>
      </div>
    </div>
  );
}
