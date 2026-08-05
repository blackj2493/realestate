'use client';

import { Lock } from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import { moveMetaFor } from '@/lib/reno/moveMeta';

/**
 * A single renovation move, rendered rich: rank, icon, cost range, timeline,
 * permit badge, and a plain "why it pays back" line. The payback column is either
 * the real value-add $ + multiple (signed-in consumers) or a lock (anon) — the
 * caller decides via `locked`, and NEVER passes VOW-derived numbers when locked.
 */
export interface RenoMoveDisplay {
  key: string;
  rank: number;
  label: string;
  costLow: number;
  costHigh: number;
  /** VOW gate — show a lock instead of the value-add + payback. */
  locked: boolean;
  /** Consumer-only: typical value the move adds. */
  valueAddTyp?: number;
  /** Consumer-only: value ÷ cost. */
  paybackRatio?: number;
  /** Part of the recommended set — highlighted. */
  recommended?: boolean;
}

function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'ok' | 'permit' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-1 font-mono text-[10.5px] font-semibold',
        tone === 'muted' && 'border-border text-muted-foreground',
        tone === 'ok' && 'border-emerald-600/35 text-emerald-700 dark:text-emerald-400',
        tone === 'permit' && 'border-amber-600/35 text-amber-700 dark:text-amber-400',
      )}
    >
      {children}
    </span>
  );
}

export default function RenoMoveCard({ m }: { m: RenoMoveDisplay }) {
  const meta = moveMetaFor(m.key);
  return (
    <div
      className={cn(
        'grid grid-cols-[auto_auto_1fr_auto] items-start gap-3 rounded-xl border p-3',
        m.recommended ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-border bg-card',
      )}
    >
      <span className="mt-1 w-4 text-center font-mono text-xs font-bold text-muted-foreground">{m.rank}</span>
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-cyan-500/10 text-lg" aria-hidden>
        {meta.icon}
      </span>
      <div className="min-w-0">
        <div className="text-[15px] font-bold leading-tight text-foreground">{m.label}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Badge>💵 {formatPrice(m.costLow)}–{formatPrice(m.costHigh)}</Badge>
          <Badge>⏱ {meta.timeline}</Badge>
          <Badge tone={meta.permit === 'none' ? 'ok' : 'permit'}>📋 {meta.permitNote}</Badge>
        </div>
        <p className="mt-2 text-xs leading-snug text-muted-foreground">{meta.why}</p>
      </div>
      <div className="shrink-0 text-right">
        {m.locked ? (
          <span className="inline-flex flex-col items-end gap-1 text-[11px] font-semibold text-muted-foreground">
            <Lock className="h-4 w-4" aria-hidden />
            payback
          </span>
        ) : (
          <>
            <div className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">
              +{formatPrice(m.valueAddTyp ?? 0)}
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {Number.isFinite(m.paybackRatio) ? `${(m.paybackRatio ?? 0).toFixed(1)}×` : '—'} back
            </div>
          </>
        )}
      </div>
    </div>
  );
}
