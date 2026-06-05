'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import type { AnonCatalogItem } from '@/lib/avm/valueAdd/anonCatalog';

/**
 * Reveal C (locked). The hero "$▓▓▓,▓▓▓" is a pure CSS-blur PLACEHOLDER — no real,
 * VOW-derived figure is ever in the DOM for anonymous users (the server sent only
 * the catalog). Unlock routes to /login?next=<funnel> ; the funnel re-submits as a
 * consumer on return (see RenovationFunnel sessionStorage rehydrate).
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
  return (
    <div className="space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-6">
      {/* Blurred hero — placeholder only */}
      <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-4 text-center">
        <p className="text-xs text-slate-400">Your home may be hiding</p>
        <p className="select-none text-3xl font-bold text-emerald-400 blur-sm" aria-hidden="true">
          $000,000
        </p>
        <p className="text-xs text-slate-400">in renovation upside</p>
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
        className="flex items-center justify-center gap-2 rounded-md border border-cyan-400/50 bg-cyan-500/20 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/30"
      >
        <Lock className="h-4 w-4" />
        Unlock my ranking{where} →
      </Link>
      <p className="text-center text-[11px] text-slate-500">Free · one-tap sign-in</p>
    </div>
  );
}
