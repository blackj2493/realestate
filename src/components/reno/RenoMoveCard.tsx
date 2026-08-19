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
        // A locked card keeps the rule in a neutral shade rather than losing it: the
        // COLOUR is the withheld signal (emerald pays back, amber does not), so an absent
        // rule hides that a verdict exists at all.
        tier?.rule ?? (m.locked ? 'border-l-[3px] border-l-border' : undefined),
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
        {/* On a phone the title and the figure fight for one line: a 17px title wraps to
            two lines and the redaction is squeezed against it. Stacking puts the hidden
            value on its own row under a hairline, where it reads as a distinct fact. From
            the sm breakpoint up this is the original single row, unchanged. */}
        <div className="flex flex-col gap-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
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

          <span className="leading-none sm:shrink-0 sm:text-right">
            {m.locked ? (
              /* REDACT, DO NOT REMOVE. Deliberately the size and position of the unlocked
                 figure below, caption included, so a signed-out card reads as a value
                 WITHHELD rather than a card that simply has no number. The old treatment —
                 a 12px grey "payback" chip — was the quietest thing on a card whose title
                 is 17px bold, so nobody registered anything was missing; owners reported
                 believing they had already been given the answer.
                 Uses the shared .redact-skeleton the VOW teasers already use (address
                 ledger, activity feed), so "withheld" looks the same everywhere and the
                 reduced-motion and dark-ground handling come for free.
                 A PLACEHOLDER, never a blurred figure: no payback number is sent to a
                 signed-out browser (see buildAnonCatalog), so rendering one — even blurred
                 — would be inventing data the server deliberately withheld. */
              <span
                className="mt-2.5 flex items-center gap-2.5 border-t border-border/70 pt-2.5 sm:mt-0 sm:block sm:border-0 sm:pt-0"
                aria-label="Payback hidden until you sign in"
              >
                <span
                  className="redact-skeleton flex h-7 w-[82px] shrink-0 items-center justify-center rounded-md text-foreground/70"
                  aria-hidden
                >
                  <Lock className="h-[15px] w-[15px]" />
                </span>
                <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground sm:mt-1 sm:block" aria-hidden>
                  for every $1
                </span>
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
          {/* The number they came for, shown as missing IN THE SLOT IT WILL OCCUPY. Without
              it the cost below is the only figure on the card, and a confident dollar
              amount reads as the answer to a question they never asked. */}
          {m.locked && (
            <>
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                <span className="redact-skeleton inline-block h-3.5 w-[74px] rounded-sm" aria-hidden />
                value added
              </span>
              <span className="text-border" aria-hidden>|</span>
            </>
          )}
          {/* "costs X to do", not "X cost": names it as the price of the work, so it cannot
              be mistaken for what the work is worth. */}
          <span>costs <span className="font-mono">{formatPrice(m.costLow)}–{formatPrice(m.costHigh)}</span> to do</span>
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
