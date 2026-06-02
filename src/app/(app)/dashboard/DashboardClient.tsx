"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
import {
  getConfig,
  saveConfig,
  getProfile,
  stampVisit,
  DEFAULT_ACTIVITY_LENS,
  DEFAULT_PERSONA,
  type DashboardConfig,
  type MarketActivityLens,
} from "@/lib/dashboard/config";
import { BOARDS } from "@/lib/dashboard/boards";
import { orderBoardsForPersona } from "@/lib/dashboard/personaDashboard";
import MissionControlHeader from "@/components/dashboard/MissionControlHeader";
import DashboardConfigPanel from "@/components/dashboard/DashboardConfigPanel";
import PlaylistBoard from "@/components/dashboard/PlaylistBoard";
import MarketActivityControls from "@/components/dashboard/MarketActivityControls";
import MarketActivityPanel from "@/components/dashboard/MarketActivityPanel";
import RecentlyViewed from "@/components/dashboard/RecentlyViewed";
import MarketPulse from "@/components/dashboard/MarketPulse";
import RegionScorecard from "@/components/dashboard/RegionScorecard";
import RegionComparisonTiles from "@/components/dashboard/RegionComparisonTiles";
import RegionDrilldown from "@/components/dashboard/RegionDrilldown";
import WatchlistSection from "@/components/dashboard/WatchlistSection";
import BubbleSections from "@/components/dashboard/BubbleSections";
import ActionFeed from "@/components/dashboard/actionfeed/ActionFeed";
import { regionArea } from "@/lib/dashboard/area";
import type { PersonaType } from "@/lib/personas/personaConfig";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// deck.gl + mapbox touch the DOM at module load → client-only, no SSR.
const DashboardHeatTile = dynamic(
  () => import("@/components/dashboard/DashboardHeatTile"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center border border-slate-800 bg-slate-950">
        <p className="terminal-font text-xs text-slate-500">Loading map…</p>
      </div>
    ),
  }
);

export default function DashboardClient() {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<DashboardConfig>({
    regions: [],
    boards: [],
    marketActivity: { ...DEFAULT_ACTIVITY_LENS },
    persona: DEFAULT_PERSONA,
    lastVisitAt: null,
  });
  const [name, setName] = useState<string | undefined>(undefined);
  const [showConfig, setShowConfig] = useState(false);
  // The previous-visit cutoff for the action feed. Captured + re-stamped once on
  // entry so "since last visit" compares against the PRIOR session, not now.
  const [sinceVisit, setSinceVisit] = useState<number | null>(null);

  // The server page (page.tsx) already enforced an authenticated session, so we
  // just hydrate the localStorage-backed config/profile and enter.
  useEffect(() => {
    setConfig(getConfig());
    setName(getProfile()?.fullName);
    const previous = stampVisit();
    setSinceVisit(previous ?? Date.now() - SEVEN_DAYS_MS);
    setReady(true);
  }, []);

  const update = (c: DashboardConfig) => {
    setConfig(c);
    saveConfig(c);
  };

  const updateLens = (lens: MarketActivityLens) => update({ ...config, marketActivity: lens });
  const updatePersona = (persona: PersonaType) => update({ ...config, persona });

  if (!ready) return null;

  // Persona reorders which boards lead (non-destructive — config.boards stays the
  // user's enable/disable set).
  const enabledBoards = orderBoardsForPersona(config.persona, config.boards)
    .map((id) => BOARDS[id])
    .filter(Boolean);
  const hasRegions = config.regions.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <MissionControlHeader
        name={name}
        persona={config.persona}
        onPersonaChange={updatePersona}
        onToggleConfig={() => setShowConfig((v) => !v)}
      />

      <main className="mx-auto max-w-[1600px] space-y-8 px-4 py-6">
        {showConfig && <DashboardConfigPanel config={config} onChange={update} />}

        <ActionFeed
          regions={config.regions}
          lens={config.marketActivity}
          persona={config.persona}
          sinceMs={sinceVisit}
        />

        <WatchlistSection />

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

        {hasRegions && (
          <MarketActivityControls lens={config.marketActivity} onChange={updateLens} />
        )}

        {hasRegions && (
          <RegionScorecard
            regions={config.regions}
            propertyTypes={config.marketActivity.propertyTypes}
            minBeds={config.marketActivity.minBeds}
            minBaths={config.marketActivity.minBaths}
            minGarage={config.marketActivity.minGarage}
            minFrontage={config.marketActivity.minFrontage}
          />
        )}

        {hasRegions && (
          <RegionComparisonTiles
            regions={config.regions}
            persona={config.persona}
            lens={config.marketActivity}
          />
        )}

        {/* Custom areas the user drew/saved lead the drill-down band — they're a
            deliberate, hand-picked focus, so they sit above the broader cities. */}
        <BubbleSections
          lens={config.marketActivity}
          enabledBoards={enabledBoards}
        />

        {hasRegions &&
          config.regions.map((loc) => {
            const area = regionArea(loc);
            return (
              <RegionDrilldown key={loc} title={loc}>
                <MarketActivityPanel area={area} lens={config.marketActivity} />

                {enabledBoards.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No boards enabled — add metrics via Customize.
                  </p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {enabledBoards.map((b) => (
                      <PlaylistBoard
                        key={b.id}
                        board={b}
                        area={area}
                        lens={config.marketActivity}
                      />
                    ))}
                  </div>
                )}
              </RegionDrilldown>
            );
          })}

        {/* Primary-region intelligence: neighbourhood heat + price trend (V1). */}
        {hasRegions && <DashboardHeatTile region={config.regions[0]} />}

        {hasRegions && (
          <section className="space-y-3">
            <h2 className="terminal-font border-b border-slate-800 pb-2 text-sm font-bold uppercase tracking-widest text-slate-100">
              Market Intelligence Pulse
            </h2>
            <MarketPulse location={config.regions[0]} />
          </section>
        )}

        {hasRegions && <RecentlyViewed />}

        {/* TRREB §6.3(i)/(k) — reliability + bona-fide-consumer notice. */}
        <p className="border-t border-slate-800 pt-6 text-center text-[11px] leading-relaxed text-slate-600">
          Data is deemed reliable but is not guaranteed accurate by PROPTX. Information herein
          must only be used by consumers that have a bona fide interest in the purchase, sale, or
          lease of real estate and may not be used for any commercial purpose. Powered by PROPTX
          MLS®.
        </p>
      </main>
    </div>
  );
}
