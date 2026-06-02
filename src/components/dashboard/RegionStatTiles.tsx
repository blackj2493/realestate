"use client";

import { useEffect, useState } from "react";
import { fetchRegionStats, type RegionStats } from "@/lib/dashboard/queries";
import { scopeKey } from "@/lib/dashboard/lensKey";
import { areaKey, type Area } from "@/lib/dashboard/area";
import type { MarketActivityLens } from "@/lib/dashboard/config";

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="terminal-font text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="terminal-font text-lg font-bold text-cyan-400">{value}</div>
    </div>
  );
}

export default function RegionStatTiles({
  area,
  lens,
}: {
  area: Area;
  lens: MarketActivityLens;
}) {
  const [s, setS] = useState<RegionStats | null>(null);
  // Stable string identity so an inline `bubbleToArea(b)` parent doesn't refire
  // the effect on every render (each call returns a new object reference).
  const key = areaKey(area);
  const scope = scopeKey(lens);

  useEffect(() => {
    let alive = true;
    setS(null);
    fetchRegionStats(area, lens)
      .then((r) => alive && setS(r))
      .catch(() => alive && setS({ activeCount: 0, topCapRate: null, suiteCandidates: 0 }));
    return () => {
      alive = false;
    };
    // `area`/`lens` captured via `key`/`scope` — re-fetch only on identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scope]);

  const dash = "—";
  const active = s ? s.activeCount.toLocaleString() : dash;
  const cap = s?.topCapRate != null ? `${s.topCapRate.toFixed(1)}%` : dash;
  const suite = s ? s.suiteCandidates.toLocaleString() : dash;

  return (
    <div className="grid grid-cols-3 gap-3">
      <Tile label="Active Listings" value={active} />
      <Tile label="Top Cap Rate" value={cap} />
      <Tile label="Suite Candidates" value={suite} />
    </div>
  );
}
