'use client';

import Link from 'next/link';
import { LineChart, ArrowRight, TrendingUp, Timer, Scissors } from 'lucide-react';

/**
 * The doorway into the region's Market Trends read — framed as an insight promise, not
 * a data dump. We name the three things the /analytics page will reveal for THIS
 * neighbourhood and deep-link straight to it. No VOW numbers render here, so it's safe
 * for anon (who land on the Market Trends teaser + sign-in); consumers land on the data.
 */
export default function RenoMarketBridge({ where, region }: { where: string; region: string }) {
  const href = `/analytics?region=${encodeURIComponent(region)}`;
  const promises = [
    { icon: TrendingUp, text: 'What sold prices are actually doing — not the asking prices' },
    { icon: Timer, text: 'How fast homes really sell here (true days on market)' },
    { icon: Scissors, text: 'Where sellers are cutting — and where they’re holding firm' },
  ];
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-border bg-gradient-to-br from-cyan-500/[0.06] to-transparent p-5 transition-colors hover:border-cyan-500/50"
    >
      <div className="flex items-center gap-2">
        <LineChart className="h-[18px] w-[18px] shrink-0 text-cyan-700 dark:text-cyan-400" strokeWidth={1.75} aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">Zoom out</span>
      </div>
      <p className="mt-2 text-lg font-bold text-foreground">See what’s really happening in {where}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        The same sold data behind these estimates — read as the story of the market, not a spreadsheet.
      </p>
      <ul className="mt-3 space-y-2">
        {promises.map((p) => {
          const Icon = p.icon;
          return (
            <li key={p.text} className="flex items-start gap-2.5 text-[13.5px] text-foreground/90">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              <span>{p.text}</span>
            </li>
          );
        })}
      </ul>
      <span className="mt-3.5 inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-700 dark:text-cyan-400">
        Open the {where} market read
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
