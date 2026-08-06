'use client';

import Link from 'next/link';
import { Lock, Building2, Hammer } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import type { EligibilityItem, EvidenceKey, LocalRules } from '@/lib/reno/localRules';
import type { EligibilityEvidence } from '@/lib/reno/eligibilityEvidence';

/**
 * The FREE rail — now ONE section: what this home could legally become, with the local
 * proof under each rule.
 *
 * What was removed, and why (owner review):
 *  • "What a second unit would earn" — it quoted ONE blended rent for "a suite", but the
 *    suite's size is exactly what we don't know (a 1-bed in-home unit leases ~$400/mo
 *    under a 2-bed nearby). A number nobody can act on is worse than no number; the
 *    leased grid on the page already prices in-home units per bedroom count.
 *  • "Know your ceiling" — the sold grid immediately above says the same thing, with
 *    every size shown instead of one summary line.
 *  • The permit table and reno-loan calculator (earlier) — restated the move cards, and
 *    a generic amortization slider any bank site offers.
 */

function EvidenceLine({ item, ev }: { item: EligibilityItem; ev: EligibilityEvidence | null }) {
  if (!ev || !item.evidence) return null;
  const radius = ev.radiusKm ? `within ${ev.radiusKm} km` : 'nearby';
  const line = evidenceText(item.evidence, ev, radius);
  if (!line) return null;
  return <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{line}</p>;
}

/** Deterministic copy for one evidence key — everything here is countable on the grids above. */
function evidenceText(key: EvidenceKey, ev: EligibilityEvidence, radius: string): string | null {
  if (key === 'suite') {
    if (ev.suiteLeases === 0) return null;
    const verb = ev.suiteSource === 'leased' ? 'leased' : 'listed';
    const range =
      ev.suiteRentLow != null && ev.suiteRentHigh != null
        ? ev.suiteRentLow === ev.suiteRentHigh
          ? ` at ${formatPrice(ev.suiteRentLow)}/mo`
          : ` at ${formatPrice(ev.suiteRentLow)}–${formatPrice(ev.suiteRentHigh)}/mo depending on size`
        : '';
    return `${ev.suiteLeases} second ${ev.suiteLeases === 1 ? 'unit' : 'units'} ${verb} ${radius}${range}.`;
  }
  if (key === 'plex') {
    if (ev.plexSales === 0) return null;
    const verb = ev.plexSource === 'sold' ? 'sold' : 'listed';
    return `${ev.plexSales} duplex/triplex-type ${ev.plexSales === 1 ? 'home' : 'homes'} ${verb} ${radius} — the conversion market is real here.`;
  }
  return null;
}

export function RenoGuidePanel({
  rules,
  unlockHref,
  onUnlock,
  isAuthed,
  evidence,
}: {
  rules: LocalRules;
  unlockHref: string;
  onUnlock: () => void;
  /** When signed in, hide the "sign in" upsell row (they're already in). */
  isAuthed?: boolean;
  /** What actually happened nearby, read off the two grids on this page. */
  evidence?: EligibilityEvidence | null;
}) {
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

      <div className="p-4">
        <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-foreground">
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          What your home could become
        </h3>
        <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
          Beyond renovating — what you could legally <b>add</b> (Ontario Bill&nbsp;23 + local rules),
          and what the homes around you have actually done with it.
        </p>
        <div className="divide-y divide-border/60">
          {rules.eligibility.map((e) => (
            <div key={e.label} className="py-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-foreground">{e.label}</span>
                <span className="shrink-0 text-right font-medium text-emerald-700 dark:text-emerald-400">{e.status}</span>
              </div>
              <EvidenceLine item={e} ev={evidence ?? null} />
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
      </div>
    </div>
  );
}
