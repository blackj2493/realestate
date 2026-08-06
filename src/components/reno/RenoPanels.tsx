'use client';

import Link from 'next/link';
import { Lock, Building2, AlertTriangle, Hammer, type LucideIcon } from 'lucide-react';
import type { LocalRules } from '@/lib/reno/localRules';

/**
 * The FREE over-deliver rail, one capsule ("Your renovation guide") with two sections
 * that each say something a generic guide can't:
 *   • what this home could legally BECOME (Ontario Bill 23 + local rules), and
 *   • where the money disappears — the area's own price ceiling and its weakest move.
 *
 * The old permit table and reno-loan calculator were dropped: per-move permit needs
 * already ride on every move card, and a generic amortization slider is available on any
 * bank site — neither cleared the §10 bar.
 */

function Section({ icon: Icon, title, first, children }: { icon: LucideIcon; title: string; first?: boolean; children: React.ReactNode }) {
  return (
    <div className={first ? 'p-4' : 'border-t border-border p-4'}>
      <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-foreground">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        {title}
      </h3>
      {children}
    </div>
  );
}

export function RenoGuidePanel({
  rules,
  unlockHref,
  onUnlock,
  isAuthed,
  ceilingNotes,
}: {
  rules: LocalRules;
  unlockHref: string;
  onUnlock: () => void;
  /** When signed in, hide the "sign in" upsell row (they're already in). */
  isAuthed?: boolean;
  /** Area-specific over-investing warnings (falls back to rules.dontOverInvest). */
  ceilingNotes?: string[];
}) {
  const notes = ceilingNotes?.length ? ceilingNotes : rules.dontOverInvest;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
        <span className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
          <Hammer className="h-[18px] w-[18px] text-cyan-700 dark:text-cyan-400" strokeWidth={1.75} aria-hidden />
          Your renovation guide
        </span>
        <span className="rounded-full border border-cyan-600/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
          Free
        </span>
      </div>

      <Section icon={Building2} title="What your home could become" first>
        <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
          Beyond renovating — what you could legally <b>add</b> (Ontario Bill&nbsp;23 + local rules).
        </p>
        <div className="divide-y divide-border/60">
          {rules.eligibility.map((e) => (
            <div key={e.label} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="text-foreground">{e.label}</span>
              <span className="shrink-0 text-right font-medium text-emerald-700 dark:text-emerald-400">{e.status}</span>
            </div>
          ))}
          {!isAuthed && (
            <Link
              href={unlockHref}
              onClick={onUnlock}
              className="flex items-center justify-between gap-3 py-2.5 text-sm text-amber-700 hover:underline dark:text-amber-500"
            >
              <span className="inline-flex items-center gap-1.5"><Lock className="h-4 w-4" aria-hidden /> Your lot’s exact zoning + suite score</span>
              <span className="shrink-0 font-medium">Sign in</span>
            </Link>
          )}
        </div>
      </Section>

      <Section icon={AlertTriangle} title="Know your ceiling">
        <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          {notes.map((d, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
