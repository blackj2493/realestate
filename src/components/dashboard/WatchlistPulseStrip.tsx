"use client";

import type { WatchlistRollup } from "@/lib/watchlist/useWatchlistSnapshot";

function Segment({ count, label, color }: { count: number; label: string; color: string }) {
  if (count === 0) return null;
  return (
    <span className={color}>
      {count} {label}
      {count === 1 ? "" : "s"}
    </span>
  );
}

/** One-line "what moved since you saved these" summary. */
export default function WatchlistPulseStrip({ rollup }: { rollup: WatchlistRollup }) {
  if (rollup.count === 0) return null;

  const { priceDrops, offMarket, goingStale } = rollup;
  const quiet = priceDrops === 0 && offMarket === 0 && goingStale === 0;

  const segments = (
    [
      { count: priceDrops, label: "price drop", color: "text-emerald-400" },
      { count: offMarket, label: "off-market", color: "text-amber-400" },
      { count: goingStale, label: "going stale", color: "text-rose-400" },
    ] as const
  ).filter((s) => s.count > 0);

  return (
    <div className="flex items-center gap-2 border border-slate-800 bg-slate-900/40 px-3 py-2">
      <span className="terminal-font text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Pulse
      </span>
      {quiet ? (
        <span className="terminal-font text-[11px] text-slate-500">
          No changes since you saved these
        </span>
      ) : (
        <span className="terminal-font flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold">
          {segments.map((s, i) => (
            <span key={s.label} className="flex items-center gap-2">
              <Segment count={s.count} label={s.label} color={s.color} />
              {i < segments.length - 1 && <span className="text-slate-600">·</span>}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
