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
import { ModuleHead } from "@/components/daylight/primitives";
import FirstRunRegionPicker from "@/components/dashboard/FirstRunRegionPicker";
import PasskeyPrompt from "@/components/auth/PasskeyPrompt";
import { regionArea } from "@/lib/dashboard/area";
import type { PersonaType } from "@/lib/personas/personaConfig";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// deck.gl + mapbox touch the DOM at module load → client-only, no SSR.
const DashboardHeatTile = dynamic(
  () => import("@/components/dashboard/DashboardHeatTile"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center border border-border bg-background">
        <p className="terminal-font text-xs text-muted-foreground">Loading map…</p>
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
  // The city the single-region intelligence tiles (Neighbourhood Heat + Market
  // Pulse) are focused on. Shared so both stay in sync; falls back to the first
  // configured region until the user picks another (and if the picked one is
  // later removed from the config).
  const [intelRegion, setIntelRegion] = useState<string | null>(null);
  // The first-run setup card stays open while the user builds their workspace (regions
  // apply live as they're added). Opened on first run (no regions), collapsed via "Done".
  const [pickerOpen, setPickerOpen] = useState(false);
  // The previous-visit cutoff for the action feed. Captured + re-stamped once on
  // entry so "since last visit" compares against the PRIOR session, not now.
  const [sinceVisit, setSinceVisit] = useState<number | null>(null);

  // The server page (page.tsx) already enforced an authenticated session, so we
  // just hydrate the localStorage-backed config/profile and enter.
  useEffect(() => {
    const cfg = getConfig();
    setConfig(cfg);
    setName(getProfile()?.fullName);
    const previous = stampVisit();
    setSinceVisit(previous ?? Date.now() - SEVEN_DAYS_MS);
    setPickerOpen(cfg.regions.length === 0); // first run → open the live setup card
    setReady(true);
  }, []);

  const update = (c: DashboardConfig) => {
    setConfig(c);
    saveConfig(c);
  };

  // Auto-apply: add/remove a single region live so its dashboard sections appear/disappear
  // instantly. Functional updates keep rapid clicks from racing on a stale `config`.
  const addRegion = (area: string) =>
    setConfig((prev) => {
      if (!area || prev.regions.includes(area)) return prev;
      const next = { ...prev, regions: [...prev.regions, area] };
      saveConfig(next);
      return next;
    });
  const removeRegion = (area: string) =>
    setConfig((prev) => {
      const next = { ...prev, regions: prev.regions.filter((r) => r !== area) };
      saveConfig(next);
      return next;
    });

  const updateLens = (lens: MarketActivityLens) => update({ ...config, marketActivity: lens });
  const updatePersona = (persona: PersonaType) => update({ ...config, persona });

  if (!ready) return <div className="min-h-app bg-background" aria-busy="true" />;

  // Persona reorders which boards lead (non-destructive — config.boards stays the
  // user's enable/disable set).
  const enabledBoards = orderBoardsForPersona(config.persona, config.boards)
    .map((id) => BOARDS[id])
    .filter(Boolean);
  const hasRegions = config.regions.length > 0;
  // Effective focus city for the intelligence tiles: the user's pick if it's still
  // a configured region, else the first region.
  const intelActive =
    intelRegion && config.regions.includes(intelRegion) ? intelRegion : config.regions[0];

  return (
    <div className="min-h-app bg-background text-foreground">
      <MissionControlHeader
        name={name}
        persona={config.persona}
        onPersonaChange={updatePersona}
        onToggleConfig={() => setShowConfig((v) => !v)}
      />

      {/* Safe-area insets via max() so they only ever ADD to the existing
          gutters (env() = 0 off-notch → pixel-identical to the original
          px-4 py-6). Keeps the bottom compliance line clear of the home
          indicator without changing desktop spacing. */}
      <main className="mx-auto max-w-[1600px] space-y-8 pt-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <PasskeyPrompt />

        {showConfig && <DashboardConfigPanel config={config} onChange={update} />}

        <ActionFeed
          regions={config.regions}
          lens={config.marketActivity}
          persona={config.persona}
          sinceMs={sinceVisit}
        />

        <WatchlistSection />

        {pickerOpen && (
          <FirstRunRegionPicker
            selected={config.regions}
            onAdd={addRegion}
            onRemove={removeRegion}
            onDone={() => setPickerOpen(false)}
          />
        )}

        {/* Once collapsed, a slim way back into the live setup card to add more areas. */}
        {!pickerOpen && hasRegions && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="terminal-font inline-flex min-h-[44px] items-center gap-1.5 border border-slate-700 bg-slate-900/40 px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
          >
            <Plus className="h-3.5 w-3.5" />
            Add areas
          </button>
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
            basement={config.marketActivity.basement}
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
                  <p className="text-xs text-muted-foreground">
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

        {/* Region intelligence: neighbourhood heat + price trend. A shared city
            switcher (rendered inside each tile when >1 region) keeps them in sync. */}
        {hasRegions && (
          <DashboardHeatTile
            regions={config.regions}
            selected={intelActive}
            onSelect={setIntelRegion}
          />
        )}

        {hasRegions && (
          <section className="space-y-3">
            <ModuleHead title="Market Intelligence Pulse" />
            <MarketPulse
              regions={config.regions}
              selected={intelActive}
              onSelect={setIntelRegion}
            />
          </section>
        )}

        {hasRegions && <RecentlyViewed />}

        {/* TRREB §6.3(i)/(k) — reliability + bona-fide-consumer notice. */}
        <p className="border-t border-border pt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
          Data is deemed reliable but is not guaranteed accurate by PROPTX. Information herein
          must only be used by consumers that have a bona fide interest in the purchase, sale, or
          lease of real estate and may not be used for any commercial purpose. Powered by PROPTX
          MLS®.
        </p>
      </main>
    </div>
  );
}
