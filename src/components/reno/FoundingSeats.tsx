'use client';

/**
 * Founding seats — the scarcity block on the reno funnel.
 *
 * Two states, both driven by a true COUNT(*) (see src/lib/founding/seats.ts):
 *   • FoundingSeatsOffer — anonymous, above the unlock CTA. Names the seat number
 *     they'd take, which is a concrete thing to lose in a way "sign in to unlock"
 *     is not, and is honest because the next serial really is taken + 1.
 *   • FoundingSeatHeld — signed in, confirming the seat they now hold.
 *
 * The seat map SHOWS the scarcity rather than asserting it: 50 cells, one lit per
 * seat gone. It is decorative — the figure beside it carries the same fact in
 * text — so it is aria-hidden.
 *
 * What a seat promises is deliberately narrow: full access stays free, permanently.
 * That is true whether or not a paid tier ever exists, so nothing here has to be
 * walked back. Do NOT reintroduce "Pro", "$X value", or any wording that prices a
 * product we don't sell.
 */

import { Check, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOUNDING_SEAT_TOTAL, type SeatSummary } from '@/lib/founding/seats';

/** 200 cells, one lit per seat gone — 20 across so the block stays wide rather than
 *  tall. Tailwind tops out at grid-cols-12, hence the arbitrary track list. */
function SeatMap({ taken }: { taken: number }) {
  const lit = Math.max(0, Math.min(taken, FOUNDING_SEAT_TOTAL));
  return (
    <div
      className="mt-2.5 grid w-[184px] grid-cols-[repeat(20,minmax(0,1fr))] gap-[2px]"
      aria-hidden
    >
      {Array.from({ length: FOUNDING_SEAT_TOTAL }, (_, i) => (
        <span
          key={i}
          className={cn(
            'block aspect-square rounded-[1px]',
            i < lit ? 'bg-cyan-600 dark:bg-cyan-400' : 'bg-cyan-600/15 dark:bg-cyan-400/15',
          )}
        />
      ))}
    </div>
  );
}

function SeatCount({ taken, total }: { taken: number; total: number }) {
  return (
    <div className="shrink-0">
      <span className="block font-mono text-[38px] font-bold leading-none tracking-tight tabular-nums text-cyan-700 dark:text-cyan-400">
        {taken}
        <span className="font-normal text-muted-foreground">/{total}</span>
      </span>
      <span className="mt-1.5 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
        seats taken
      </span>
      <SeatMap taken={taken} />
    </div>
  );
}

/** Anonymous — sits directly above the unlock CTA, whose own wording is unchanged. */
export function FoundingSeatsOffer({ seats }: { seats: SeatSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-cyan-600/35 bg-cyan-500/10 p-4">
      <SeatCount taken={seats.taken} total={seats.total} />
      <div className="min-w-0 flex-1 basis-56">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.15em] text-cyan-700 dark:text-cyan-400">
          Founding seats
        </div>
        {seats.soldOut ? (
          <p className="mt-1 text-[13.5px] leading-relaxed text-foreground">
            All {seats.total} founding seats are taken. Signing in still unlocks your full result —
            and puts you first in line if more open up.
          </p>
        ) : (
          <p className="mt-1 text-[13.5px] leading-relaxed text-foreground">
            Signing in takes seat{' '}
            <b className="font-mono font-bold text-cyan-700 dark:text-cyan-400">#{seats.next}</b>.
            Seat holders keep full access free, permanently. No card, nothing to cancel.
          </p>
        )}
      </div>
    </div>
  );
}

/** Signed in — the seat is already theirs; it was taken during the auto-resubmit. */
export function FoundingSeatHeld({ seat, total }: { seat: number; total: number }) {
  const founding = seat <= total;
  return (
    <div
      className={cn(
        'flex items-center gap-3.5 rounded-xl border p-4',
        founding
          ? 'border-emerald-600/40 bg-emerald-500/10'
          : 'border-border bg-card',
      )}
    >
      <span
        className={cn(
          'grid h-9 w-9 shrink-0 place-items-center rounded-full text-white',
          founding ? 'bg-emerald-600' : 'bg-muted-foreground',
        )}
        aria-hidden
      >
        {founding ? <Check className="h-[18px] w-[18px]" strokeWidth={2.5} /> : <Lock className="h-4 w-4" />}
      </span>
      <div className="min-w-0">
        {founding ? (
          <>
            <p className="text-[14.5px] font-semibold text-foreground">
              Seat <span className="font-mono text-emerald-700 dark:text-emerald-400">#{seat}</span> of{' '}
              {total} is yours.
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              Full access stays free, permanently — nothing to renew, nothing to cancel.
            </p>
          </>
        ) : (
          <>
            <p className="text-[14.5px] font-semibold text-foreground">
              You&apos;re on the list at{' '}
              <span className="font-mono">#{seat}</span>.
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              The {total} founding seats went first. You&apos;ll get the next release before anyone else.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
