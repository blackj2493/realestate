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
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3',
        m.recommended ? 'border-emerald-500/25 bg-emerald-500/[0.04]' : 'border-border bg-card',
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-500/10 text-lg" aria-hidden>
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-bold leading-tight text-foreground">{m.label}</span>
          <span className="shrink-0 text-right">
            {m.locked ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <Lock className="h-3.5 w-3.5" aria-hidden /> payback
              </span>
            ) : (
              <span className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">
                +{formatPrice(m.valueAddTyp ?? 0)}
              </span>
            )}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
          <span>{formatPrice(m.costLow)}–{formatPrice(m.costHigh)}</span>
          <span aria-hidden>·</span>
          <span>{meta.timeline}</span>
          <span aria-hidden>·</span>
          <span className={meta.permit === 'none' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
            {meta.permitNote}
          </span>
          {!m.locked && Number.isFinite(m.paybackRatio) && (
            <>
              <span aria-hidden>·</span>
              <span className="font-semibold text-foreground">{(m.paybackRatio ?? 0).toFixed(1)}× back</span>
            </>
          )}
        </div>

        <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{meta.why}</p>
      </div>
    </div>
  );
}
