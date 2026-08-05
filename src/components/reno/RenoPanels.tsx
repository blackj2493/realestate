'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import { calculateCanadianMonthlyMortgage } from '@/lib/finance/canadianMortgage';
import type { LocalRules } from '@/lib/reno/localRules';

/**
 * The FREE over-deliver rail — all non-VOW, publicly-sourced content: permits,
 * a live financing model, "what your home could become" eligibility (area rules),
 * and "don't over-invest". Plus a small "what we assumed" panel that doubles as
 * the escape hatch into a precise, personalised read.
 */

function Panel({
  title,
  free = true,
  children,
  accent,
}: {
  title: React.ReactNode;
  free?: boolean;
  children: React.ReactNode;
  accent?: 'violet';
}) {
  return (
    <div
      className={
        'rounded-xl border bg-card p-4 ' +
        (accent === 'violet' ? 'border-violet-500/30' : 'border-border')
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-bold text-foreground">{title}</h3>
        {free && (
          <span className="rounded-full border border-cyan-600/35 bg-cyan-500/10 px-2 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
            Free
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function EligibilityPanel({ rules, unlockHref, onUnlock }: { rules: LocalRules; unlockHref: string; onUnlock: () => void }) {
  return (
    <Panel title="➕ What your home could become" accent="violet">
      <p className="mb-2.5 text-[11.5px] text-muted-foreground">
        Beyond renovating — what you could legally <b>add</b> (Ontario Bill&nbsp;23 + local rules).
      </p>
      <div className="divide-y divide-dashed divide-border">
        {rules.eligibility.map((e) => (
          <div key={e.label} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
            <span className="text-foreground">{e.label}</span>
            <span className="shrink-0 text-right font-semibold text-emerald-700 dark:text-emerald-400">{e.status}</span>
          </div>
        ))}
        <Link
          href={unlockHref}
          onClick={onUnlock}
          className="flex items-center justify-between gap-3 py-1.5 text-[12.5px] text-amber-700 hover:underline dark:text-amber-400"
        >
          <span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Your lot’s exact zoning + suite score</span>
          <span className="shrink-0 font-semibold">Sign in</span>
        </Link>
      </div>
    </Panel>
  );
}

export function PermitsPanel({ rules }: { rules: LocalRules }) {
  return (
    <Panel title={`📋 Permits & rules — ${rules.cityLabel}`}>
      <div className="divide-y divide-dashed divide-border">
        {rules.permits.map((p) => (
          <div key={p.work} className="flex items-start justify-between gap-3 py-1.5 text-[12.5px]">
            <span className="text-foreground">{p.work}</span>
            <span className="shrink-0 text-right text-muted-foreground">{p.need}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{rules.permitReviewNote}</p>
    </Panel>
  );
}

const RENO_RATE = 0.069; // ~HELOC / reno-loan rate; wired to live rates as a fast-follow.
const RENO_MONTHS = 180; // 15-yr amortization

export function FinancingPanel() {
  const [budget, setBudget] = useState(60000);
  const monthly = calculateCanadianMonthlyMortgage(budget, RENO_RATE, RENO_MONTHS);
  return (
    <Panel title="💳 Model your reno">
      <p className="mb-2 text-[11.5px] text-muted-foreground">
        Roughly, at ~{(RENO_RATE * 100).toFixed(1)}% over 15 years.
      </p>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-extrabold text-foreground">{formatPrice(Math.round(monthly))}</span>
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
    </Panel>
  );
}

export function DontOverInvestPanel({ rules }: { rules: LocalRules }) {
  return (
    <Panel title="⚠️ Don’t over-invest">
      <ul className="ml-4 list-disc space-y-1.5 text-[12.5px] text-muted-foreground marker:text-muted-foreground/50">
        {rules.dontOverInvest.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
    </Panel>
  );
}

export function AssumptionsPanel({ typeLabel, onRefine }: { typeLabel: string; onRefine: () => void }) {
  return (
    <Panel title="🏡 What this assumes" free={false}>
      <p className="text-[12.5px] text-muted-foreground">
        A <b className="text-foreground">typical {typeLabel.toLowerCase()}</b> in this area — about 3 bed, 2 bath, standard condition.
      </p>
      <button
        type="button"
        onClick={onRefine}
        className="mt-2 text-[12.5px] font-semibold text-cyan-700 hover:underline dark:text-cyan-400"
      >
        Not typical? Add your details →
      </button>
    </Panel>
  );
}
