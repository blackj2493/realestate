'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import type { AnonCatalogItem } from '@/lib/avm/valueAdd/anonCatalog';

/**
 * Reveal C (locked). The blurred hero band is computed from the PUBLIC catalog
 * cost ranges only (costLow/costHigh) — NO VOW-derived value-add dollars are ever
 * in the DOM for anonymous users (the server sent only the catalog). It is still
 * rendered blurred + select-none + aria-hidden as a teaser. Unlock routes to
 * /login?next=<funnel>; the funnel re-submits as a consumer on return (see
 * RenovationFunnel sessionStorage rehydrate).
 */
export default function RenovationRevealLocked({
  community,
  catalog,
  unlockHref,
  onUnlock,
}: {
  community: string | null;
  catalog: AnonCatalogItem[];
  unlockHref: string;
  onUnlock: () => void;
}) {
  const where = community ? ` in ${community}` : '';

  // Real, catalog-derived investment band (sum of applicable move cost ranges).
  // This is public construction-cost data — not an AVM/VOW figure.
  const bandLow = catalog.reduce((sum, m) => sum + (m.costLow || 0), 0);
  const bandHigh = catalog.reduce((sum, m) => sum + (m.costHigh || 0), 0);
  const hasBand = catalog.length > 0 && bandHigh > 0;

  return (
    <div className="space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-6">
      {/* Blurred hero — real catalog cost band, teased behind blur */}
      <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-4 text-center">
        <p className="text-xs text-slate-400">
          {catalog.length} renovation {catalog.length === 1 ? 'move' : 'moves'} could apply
          to your home
        </p>
        <p
          className="select-none text-3xl font-bold text-emerald-400 blur-sm"
          aria-hidden="true"
        >
          {hasBand ? `${formatPrice(bandLow)}–${formatPrice(bandHigh)}` : '$00,000–$000,000'}
        </p>
        <p className="text-xs text-slate-400">
          to invest — sign in to see which ones pay you back most
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm text-slate-300">We&apos;ll rank these for your home:</p>
        <div className="space-y-1.5">
          {catalog.map((m) => (
            <div key={m.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-300">{m.label}</span>
              <span className="shrink-0 font-mono text-slate-400">
                {formatPrice(m.costLow)}–{formatPrice(m.costHigh)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Link
        href={unlockHref}
        onClick={onUnlock}
        className="flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 active:bg-cyan-700 [touch-action:manipulation]"
      >
        <Lock className="h-4 w-4" />
        Unlock my ranking{where} →
      </Link>
      <p className="text-center text-[11px] leading-relaxed text-slate-500">
        Free · one-tap sign-in · No spam — alerts are opt-in only.
        <br />
        PIPEDA-compliant.{' '}
        <Link
          href="/privacy"
          className="text-slate-400 underline underline-offset-2 hover:text-slate-300"
        >
          Privacy
        </Link>
        .
      </p>
    </div>
  );
}
