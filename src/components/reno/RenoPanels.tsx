'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Lock, Building2, ClipboardCheck, Calculator, AlertTriangle, Hammer, type LucideIcon } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import { calculateCanadianMonthlyMortgage } from '@/lib/finance/canadianMortgage';
import type { LocalRules } from '@/lib/reno/localRules';

/**
 * The FREE over-deliver rail, consolidated into ONE capsule ("Your renovation
 * guide") with quiet internal sections — eligibility, permits, a live financing
 * model, and "don't over-invest". All non-VOW, publicly-sourced.
 */

const RENO_RATE = 0.069; // ~HELOC / reno-loan rate; wired to live rates as a fast-follow.
const RENO_MONTHS = 180; // 15-yr amortization

function Section({ icon: Icon, title, first, children }: { icon: LucideIcon; title: string; first?: boolean; children: React.ReactNode }) {
  return (
    <div className={first ? 'p-4' : 'border-t border-border p-4'}>
      <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        {title}
      </h3>
      {children}
    </div>
  );
}

function FinancingSection() {
  const [budget, setBudget] = useState(60000);
  const monthly = calculateCanadianMonthlyMortgage(budget, RENO_RATE, RENO_MONTHS);
  return (
    <>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-foreground">{formatPrice(Math.round(monthly))}</span>
        <span className="text-xs text-muted-foreground">/mo for a {formatPrice(budget)} reno</span>
      </div>
      <input
        type="range"
        min={10000}
        max={150000}
        step={5000}
        value={budget}
        onChange={(e) => setBudget(Number(e.target.value))}
        aria-label="Reno budget"
        className="mt-3 w-full accent-cyan-600 dark:accent-cyan-400"
      />
      <div className="flex justify-between text-[10.5px] text-muted-foreground">
        <span>$10k</span>
        <span>$150k</span>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">Roughly, at ~{(RENO_RATE * 100).toFixed(1)}% over 15 years.</p>
    </>
  );
}

export function RenoGuidePanel({
  rules,
  unlockHref,
  onUnlock,
  isAuthed,
}: {
  rules: LocalRules;
  unlockHref: string;
  onUnlock: () => void;
  /** When signed in, hide the "sign in" upsell row (they're already in). */
  isAuthed?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <Hammer className="h-4 w-4 text-cyan-700 dark:text-cyan-400" strokeWidth={1.75} aria-hidden />
          Your renovation guide
        </span>
        <span className="rounded-full border border-cyan-600/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
          Free
        </span>
      </div>

      <Section icon={Building2} title="What your home could become" first>
        <p className="mb-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          Beyond renovating — what you could legally <b>add</b> (Ontario Bill&nbsp;23 + local rules).
        </p>
        <div className="divide-y divide-border/60">
          {rules.eligibility.map((e) => (
            <div key={e.label} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
              <span className="text-foreground">{e.label}</span>
              <span className="shrink-0 text-right font-medium text-emerald-700 dark:text-emerald-400">{e.status}</span>
            </div>
          ))}
          {!isAuthed && (
            <Link
              href={unlockHref}
              onClick={onUnlock}
              className="flex items-center justify-between gap-3 py-2 text-[12.5px] text-amber-700 hover:underline dark:text-amber-500"
            >
              <span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" aria-hidden /> Your lot’s exact zoning + suite score</span>
              <span className="shrink-0 font-medium">Sign in</span>
            </Link>
          )}
        </div>
      </Section>

      <Section icon={ClipboardCheck} title={`Permits & rules — ${rules.cityLabel}`}>
        <div className="divide-y divide-border/60">
          {rules.permits.map((p) => (
            <div key={p.work} className="flex items-start justify-between gap-3 py-2 text-[12.5px]">
              <span className="text-foreground">{p.work}</span>
              <span className="shrink-0 text-right text-muted-foreground">{p.need}</span>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">{rules.permitReviewNote}</p>
      </Section>

      <Section icon={Calculator} title="Model your reno">
        <FinancingSection />
      </Section>

      <Section icon={AlertTriangle} title="Don’t over-invest">
        <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
          {rules.dontOverInvest.map((d, i) => (
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
