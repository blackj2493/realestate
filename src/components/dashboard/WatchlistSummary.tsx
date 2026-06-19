"use client";

import type { WatchlistRollup } from "@/lib/watchlist/useWatchlistSnapshot";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="terminal-font text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="terminal-font truncate text-lg font-bold text-cyan-400" title={value}>
        {value}
      </div>
    </div>
  );
}

function compactPrice(n: number): string {
  if (n >= 1_000_000) return `$${(Math.round((n / 1_000_000) * 100) / 100).toString()}M`;
  if (n >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}

/**
 * At-a-glance characterization of the SAVED set — what you're watching, not a
 * portfolio of holdings. No sum metrics (you're not buying all of them).
 */
export default function WatchlistSummary({ rollup }: { rollup: WatchlistRollup }) {
  if (rollup.count === 0) return null;

  const dash = "—";
  const range =
    rollup.minPrice == null || rollup.maxPrice == null
      ? dash
      : rollup.minPrice === rollup.maxPrice
        ? compactPrice(rollup.minPrice)
        : `${compactPrice(rollup.minPrice)}–${compactPrice(rollup.maxPrice)}`;
  const cap = rollup.avgCapRate != null ? `${rollup.avgCapRate.toFixed(1)}%` : dash;
  const best = rollup.bestDeal ? `${rollup.bestDeal.grade} · ${rollup.bestDeal.score}` : dash;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Saved" value={rollup.count.toLocaleString()} />
      <Tile label="Price Range" value={range} />
      <Tile label="Avg Cap Rate" value={cap} />
      <Tile label="Best Deal Score" value={best} />
    </div>
  );
}
