'use client';

import Link from 'next/link';
import { Lock, Lightbulb } from 'lucide-react';

/**
 * The ANON teaser for the ranked moves — one card explaining what sits behind the gate.
 *
 * It used to have a second life: for signed-in users it rendered a 3-card "what the sales
 * quietly tell you" strip. That strip was deleted (owner review) because it restated the
 * move cards verbatim — same multiple, same decode line, same winner and loser — in about
 * a screen of extra height. The cards already lead with the winner and split out the moves
 * that don't pay back, so the strip was a second telling of one story.
 *
 * The teaser survives only because the anon card list carries NO numbers at all (payback
 * is VOW-derived), so this is the only thing on the page that says what's being withheld.
 */
export default function RenoInsightStrip({
  where,
  unlockHref,
  onUnlock,
}: {
  where: string;
  unlockHref: string;
  onUnlock: () => void;
}) {
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
