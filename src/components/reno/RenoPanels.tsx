'use client';

import Link from 'next/link';
import { Lock, Building2, AlertTriangle, Hammer, KeyRound, type LucideIcon } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import type { LocalRules } from '@/lib/reno/localRules';
import { paybackRange, type SuiteEconomics } from '@/lib/reno/suiteEconomics';

/**
 * The FREE over-deliver rail, one capsule ("Your renovation guide"), each section saying
 * something a generic guide can't:
 *   • what a SECOND UNIT would actually earn here — real in-home-unit rents within 2 km
 *     against the engine's build cost, i.e. the payback period nobody else computes,
 *   • what this home could legally BECOME (Ontario Bill 23 + local rules), and
 *   • where the money disappears — the local price ceiling and the weakest move.
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

/**
 * "What a second unit would earn" — the guide's lead, because it is the only number that
 * decides whether an owner builds one. Rent is local and real (in-home units within the
 * grid's radius); cost and resale come from the same engine that ranks the moves.
 */
function SuiteSection({ s, where }: { s: SuiteEconomics; where: string }) {
  return (
    <>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">
          {formatPrice(s.monthlyRent)}
        </span>
        <span className="text-[13px] text-muted-foreground">/mo</span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        What a basement or in-home unit {s.rentSource === 'leased' ? 'actually rents for' : 'is being listed at'} near{' '}
        {where} — {formatPrice(s.annualRent)} a year, across {s.sampleCount} {s.sampleCount === 1 ? 'unit' : 'units'}.
      </p>
      <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">Cost to build legally</span>
          <span className="shrink-0 font-medium text-foreground">
            {formatPrice(s.costLow)}–{formatPrice(s.costHigh)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">Rent pays it back in</span>
          <span className="shrink-0 font-bold text-emerald-700 dark:text-emerald-400">{paybackRange(s)}</span>
        </div>
        {s.resaleAdd != null && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Then adds at resale</span>
            <span className="shrink-0 font-medium text-foreground">+{formatPrice(s.resaleAdd)}</span>
          </div>
        )}
      </div>
      <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
        The rent is the payoff a resale multiple never shows — a suite that recovers little at
        sale can still be the best money on this list.
      </p>
    </>
  );
}

export function RenoGuidePanel({
  rules,
  unlockHref,
  onUnlock,
  isAuthed,
  ceilingNotes,
  suite,
  where,
}: {
  rules: LocalRules;
  unlockHref: string;
  onUnlock: () => void;
  /** When signed in, hide the "sign in" upsell row (they're already in). */
  isAuthed?: boolean;
  /** Area-specific over-investing warnings (falls back to rules.dontOverInvest). */
  ceilingNotes?: string[];
  /** Local suite payback maths — omitted when the area has no in-home-unit rents. */
  suite?: SuiteEconomics | null;
  where: string;
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

      {suite && (
        <Section icon={KeyRound} title="What a second unit would earn" first>
          <SuiteSection s={suite} where={where} />
        </Section>
      )}

      <Section icon={Building2} title="What your home could become" first={!suite}>
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
