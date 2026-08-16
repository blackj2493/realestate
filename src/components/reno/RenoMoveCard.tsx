'use client';

import { Lock } from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import { moveMetaFor } from '@/lib/reno/moveMeta';
import { roiTier, roiDecode, moveFlag, type RoiTier } from '@/lib/reno/insights';

/**
 * A single renovation move, framed as an insight: the PAYBACK MULTIPLE is the hero
 * ("3.1×" / "0.6×"), colour-coded by whether it actually pays back, with a plain
 * decode line ("every $1 adds ~$3.10" / "recover ~60¢ per $1") and a small chip on
 * the counter-intuitive ones. The dollar value-add rides quietly in the meta line.
 */
export interface RenoMoveDisplay {
  key: string;
  rank: number;
  label: string;
  costLow: number;
  costHigh: number;
  /** VOW gate — show a lock instead of the multiple + value-add. */
  locked: boolean;
  valueAddTyp?: number;
  paybackRatio?: number;
  recommended?: boolean;
}

/** Tier → colour classes for the multiple, its decode line, and the card's left rule. */
const TIER: Record<RoiTier, { fig: string; decode: string; rule: string; tile: string }> = {
  strong: {
    fig: 'text-emerald-700 dark:text-emerald-400',
    decode: 'text-emerald-700/90 dark:text-emerald-400/90',
    rule: 'border-l-[3px] border-l-emerald-500',
    tile: 'text-emerald-700 dark:text-emerald-400',
  },
  good: {
    fig: 'text-emerald-700 dark:text-emerald-400',
    decode: 'text-muted-foreground',
    rule: 'border-l-[3px] border-l-emerald-500/70',
    tile: 'text-emerald-700 dark:text-emerald-400',
  },
  weak: {
    fig: 'text-amber-700 dark:text-amber-500',
    decode: 'text-amber-700/90 dark:text-amber-500/90',
    rule: 'border-l-[3px] border-l-amber-500/70',
    tile: 'text-amber-700 dark:text-amber-500',
  },
  poor: {
    fig: 'text-amber-700 dark:text-amber-500',
    decode: 'text-amber-700/90 dark:text-amber-500/90',
    rule: 'border-l-[3px] border-l-amber-500/60',
    tile: 'text-amber-700 dark:text-amber-500',
  },
};

export default function RenoMoveCard({ m }: { m: RenoMoveDisplay }) {
  const meta = moveMetaFor(m.key);
  const Icon = meta.icon;
  const r = m.paybackRatio;
  const hasRoi = !m.locked && Number.isFinite(r);
  const tier = hasRoi ? TIER[roiTier(r!)] : null;
  const flag = m.locked ? null : moveFlag(m);

  return (
    <div
      className={cn(
        'flex items-start gap-3.5 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-border/70',
        tier?.rule,
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/40',
          tier?.tile ?? 'text-cyan-700 dark:text-cyan-400',
        )}
        aria-hidden
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>

      <div className="min-w-0 flex-1">
        {/* title + the hero multiple */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[17px] font-semibold leading-snug text-foreground">{m.label}</span>
              {flag && (
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
                    flag.tone === 'overlooked'
                      ? 'border-cyan-600/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400'
                      : 'border-amber-600/35 bg-amber-500/10 text-amber-700 dark:text-amber-500',
                  )}
                >
                  {flag.label}
                </span>
              )}
            </div>
          </div>

          <span className="shrink-0 text-right leading-none">
            {m.locked ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Lock className="h-4 w-4" aria-hidden /> payback
              </span>
            ) : hasRoi ? (
              <>
                <span className={cn('block font-mono text-[26px] font-bold tracking-tight', tier!.fig)}>
                  {r!.toFixed(1)}×
                </span>
                <span className="mt-0.5 block text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  for every $1
                </span>
              </>
            ) : null}
          </span>
        </div>

        {/* plain-language decode of the multiple */}
        {hasRoi && (
          <p className={cn('mt-1.5 text-[13px] font-medium', tier!.decode)}>{roiDecode(r!)}</p>
        )}

        {/* quiet meta line — value added, cost, timeline, permit */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted-foreground">
          {!m.locked && Number.isFinite(m.valueAddTyp) && (
            <>
              <span className="font-mono font-semibold text-foreground">+{formatPrice(m.valueAddTyp ?? 0)} value</span>
              <span className="text-border" aria-hidden>|</span>
            </>
          )}
          <span className="font-mono">{formatPrice(m.costLow)}–{formatPrice(m.costHigh)} cost</span>
          <span className="text-border" aria-hidden>|</span>
          <span>{meta.timeline}</span>
          <span className="text-border" aria-hidden>|</span>
          <span className={meta.permit === 'none' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-500'}>
            {meta.permitNote}
          </span>
        </div>

        <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{meta.why}</p>
      </div>
    </div>
  );
}
