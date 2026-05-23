"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  hasAccess,
  getConfig,
  saveConfig,
  getProfile,
  type DashboardConfig,
} from "@/lib/dashboard/config";
import { BOARDS } from "@/lib/dashboard/boards";
import MissionControlHeader from "@/components/dashboard/MissionControlHeader";
import DashboardConfigPanel from "@/components/dashboard/DashboardConfigPanel";
import PlaylistBoard from "@/components/dashboard/PlaylistBoard";
import RegionStatTiles from "@/components/dashboard/RegionStatTiles";
import SinceLastVisit from "@/components/dashboard/SinceLastVisit";
import RecentlyViewed from "@/components/dashboard/RecentlyViewed";
import MarketPulse from "@/components/dashboard/MarketPulse";

export default function DashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<DashboardConfig>({ regions: [], boards: [] });
  const [name, setName] = useState<string | undefined>(undefined);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    // First-timers without granted access get bounced to the velvet rope.
    if (!hasAccess()) {
      router.replace("/");
      return;
    }
    setConfig(getConfig());
    setName(getProfile()?.fullName);
    setReady(true);
  }, [router]);

  const update = (c: DashboardConfig) => {
    setConfig(c);
    saveConfig(c);
  };

  if (!ready) return null;

  const enabledBoards = config.boards.map((id) => BOARDS[id]).filter(Boolean);
  const hasRegions = config.regions.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <MissionControlHeader name={name} onToggleConfig={() => setShowConfig((v) => !v)} />

      <main className="mx-auto max-w-[1600px] space-y-8 px-4 py-6">
        {showConfig && <DashboardConfigPanel config={config} onChange={update} />}

        {!hasRegions && (
          <div className="border border-dashed border-slate-700 bg-slate-900/40 px-6 py-16 text-center">
            <h2 className="terminal-font text-sm font-bold uppercase tracking-widest text-slate-200">
              No market areas yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
              Add the cities or neighbourhoods you invest in to populate your
              investment playlists and market intelligence.
            </p>
            <button
              type="button"
              onClick={() => setShowConfig(true)}
              className="terminal-font mt-6 inline-flex items-center gap-2 border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-xs uppercase tracking-wider text-cyan-200 hover:bg-cyan-500/20"
            >
              <Plus className="h-4 w-4" /> Add a market area
            </button>
          </div>
        )}

        {hasRegions &&
          config.regions.map((loc) => (
            <section key={loc} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <h2 className="terminal-font text-sm font-bold uppercase tracking-widest text-slate-100">
                  {loc}
                </h2>
                <SinceLastVisit location={loc} />
              </div>

              <RegionStatTiles location={loc} />

              {enabledBoards.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No boards enabled — add metrics via Customize.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {enabledBoards.map((b) => (
                    <PlaylistBoard key={b.id} board={b} location={loc} />
                  ))}
                </div>
              )}
            </section>
          ))}

        {/* One Market Pulse chart for the primary region (V1 — see plan). */}
        {hasRegions && (
          <section className="space-y-3">
            <h2 className="terminal-font border-b border-slate-800 pb-2 text-sm font-bold uppercase tracking-widest text-slate-100">
              Market Intelligence Pulse
            </h2>
            <MarketPulse location={config.regions[0]} />
          </section>
        )}

        {hasRegions && <RecentlyViewed />}
      </main>
    </div>
  );
}
