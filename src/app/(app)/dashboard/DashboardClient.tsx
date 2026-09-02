"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import {
  getConfig,
  saveConfig,
  normalizeConfig,
  getProfile,
  stampVisit,
  DEFAULT_ACTIVITY_LENS,
  DEFAULT_PERSONA,
  type DashboardConfig,
  type MarketActivityLens,
} from "@/lib/dashboard/config";
import { fetchServerConfig, pushConfig } from "@/lib/dashboard/configSync";
import { BOARDS } from "@/lib/dashboard/boards";
import { orderBoardsForPersona } from "@/lib/dashboard/personaDashboard";
import MissionControlHeader from "@/components/dashboard/MissionControlHeader";
import DashboardConfigPanel from "@/components/dashboard/DashboardConfigPanel";
import PlaylistBoard from "@/components/dashboard/PlaylistBoard";
import MarketActivityControls from "@/components/dashboard/MarketActivityControls";
import MarketActivityPanel from "@/components/dashboard/MarketActivityPanel";
import RecentlyViewed from "@/components/dashboard/RecentlyViewed";
import MarketPulse from "@/components/dashboard/MarketPulse";
import NeighbourhoodLeaderboard from "@/components/dashboard/NeighbourhoodLeaderboard";
import RegionScorecard from "@/components/dashboard/RegionScorecard";
import RegionComparisonTiles from "@/components/dashboard/RegionComparisonTiles";
import RegionDrilldown, { sectionSummary } from "@/components/dashboard/RegionDrilldown";
import WatchlistSection from "@/components/dashboard/WatchlistSection";
import BubbleSections from "@/components/dashboard/BubbleSections";
import CityAlertBell from "@/components/dashboard/CityAlertBell";
import ActionFeed from "@/components/dashboard/actionfeed/ActionFeed";
import { ModuleHead } from "@/components/daylight/primitives";
import FirstRunRegionPicker from "@/components/dashboard/FirstRunRegionPicker";
import PasskeyPrompt from "@/components/auth/PasskeyPrompt";
import { formatRegionLabel } from "@/lib/regions/formatRegionLabel";
import { regionArea, defaultAlertScopeForRegion } from "@/lib/dashboard/area";
import { useBubblesStore } from "@/lib/bubbles/useBubbles";
import type { PersonaType } from "@/lib/personas/personaConfig";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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

  // Exactly one section on the dashboard may open itself on a first visit
  // (RegionDrilldown.autoOpenFirstRun). Bubbles lead the band and claim it when the user
  // has any, so a city only takes the job once we KNOW there are none — gating on
  // `bubblesLoaded` stops a city latching open in the beat before the store answers.
  // Both selectors return primitives, so neither creates a new object per render.
  const bubblesLoaded = useBubblesStore((s) => s.loaded);
  const bubbleCount = useBubblesStore(
    (s) => Object.values(s.items).filter((b) => b.area_type !== "city").length
  );
  const cityMayAutoOpen = bubblesLoaded && bubbleCount === 0;

  /**
   * Another device wrote a newer config while this tab held an older copy. Take theirs.
   *
   * This tab's pending edit is dropped, which is the point: the old behaviour was to
   * overwrite, and overwriting is what erased saved areas across devices while their
   * alert rows (stored in a different table) survived and kept emailing. Losing one lens
   * tweak is the cheaper failure. We do not push back — pushConfig has already advanced
   * its baseline, so a re-push here would just start a ping-pong between two tabs.
   */
  const adoptServer = (raw: unknown) => {
    const merged = normalizeConfig(raw);
    setConfig(merged);
    saveConfig(merged);
    setPickerOpen(merged.regions.length === 0);
  };

  const push = (c: DashboardConfig) => pushConfig(c, { onServerNewer: adoptServer });

  // Hydrate localStorage-first (instant paint), then reconcile with the server
  // copy (dashboard_prefs, migration 096) so the config follows the ACCOUNT, not
  // the browser. Server wins on load AND on a conflicting write (see adoptServer).
  useEffect(() => {
    const cfg = getConfig();
    setConfig(cfg);
    setName(getProfile()?.fullName);
    const previous = stampVisit();
    setSinceVisit(previous ?? Date.now() - SEVEN_DAYS_MS);
    setPickerOpen(cfg.regions.length === 0); // first run → open the live setup card
    setReady(true);

    let cancelled = false;
    (async () => {
      const server = await fetchServerConfig();
      if (cancelled || server.unavailable) return; // signed-out/offline → local-only
      if (server.config) {
        const merged = normalizeConfig(server.config);
        // The action-feed cutoff should honour visits from OTHER devices too.
        const serverPrev = merged.lastVisitAt;
        if (serverPrev !== null && (previous === null || serverPrev > previous)) {
          setSinceVisit(serverPrev);
        }
        merged.lastVisitAt = Date.now(); // re-stamp this visit on the merged copy
        setConfig(merged);
        saveConfig(merged);
        push(merged);
        setPickerOpen(merged.regions.length === 0);
      } else {
        // Signed in but never synced — seed the server from this device.
        push({ ...cfg, lastVisitAt: Date.now() });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (c: DashboardConfig) => {
    setConfig(c);
    saveConfig(c);
    push(c);
  };

  // Auto-apply: add/remove a single region live so its dashboard sections appear/disappear
  // instantly. Functional updates keep rapid clicks from racing on a stale `config`.
  const addRegion = (area: string) => {
    let added = false;
    setConfig((prev) => {
      if (!area || prev.regions.includes(area)) return prev;
      added = true;
      const next = { ...prev, regions: [...prev.regions, area] };
      saveConfig(next);
      push(next);
      return next;
    });
    // Tiered default-ON alerts (§176): materialize the area's new-listing alert as a
    // city bubble the nightly worker can deliver against, so "add an area" also turns on
    // its email. Whole cities default to 'filtered' (the current dashboard lens) to avoid
    // a city-wide firehose; communities/neighbourhoods default to 'all'. Best-effort —
    // never blocks the (local, instant) region add; the section bell is the manual fallback.
    if (added) void ensureAreaAlert(area);
  };
  const removeRegion = (area: string) => {
    setConfig((prev) => {
      const next = { ...prev, regions: prev.regions.filter((r) => r !== area) };
      saveConfig(next);
      push(next);
      return next;
    });
    // Keep alerts from outliving the visible area: removing a region also removes its
    // auto-created city alert (its bell lives on the section that just disappeared).
    // Drawn/school bubbles are unaffected. Re-adding the area re-creates the alert.
    void removeAreaAlert(area);
  };

  // Find this region's materialized city-alert bubble in the store, if any.
  const findCityAlert = (area: string) =>
    Object.values(useBubblesStore.getState().items).find(
      (b) => b.area_type === "city" && b.source.kind === "city" && b.source.city === area
    );

  const ensureAreaAlert = async (area: string) => {
    await useBubblesStore.getState().init(); // idempotent; sets signedIn + loads rows
    const store = useBubblesStore.getState();
    if (!store.signedIn || findCityAlert(area)) return;
    const scope = defaultAlertScopeForRegion(area);
    await store.create({
      name: area,
      area_type: "city",
      polygon: [],
      source: { kind: "city", city: area },
      filters: scope === "filtered" ? { lens: config.marketActivity } : null,
      alert_scope: scope,
    });
  };

  const removeAreaAlert = async (area: string) => {
    await useBubblesStore.getState().init();
    const store = useBubblesStore.getState();
    if (!store.signedIn) return;
    const existing = findCityAlert(area);
    if (existing) await store.remove(existing.id);
  };

  const updateLens = (lens: MarketActivityLens) => update({ ...config, marketActivity: lens });
  const updatePersona = (persona: PersonaType) => update({ ...config, persona });

  if (!ready) return <div className="min-h-app bg-background" aria-busy="true" />;

  // Persona reorders which boards lead (non-destructive — config.boards stays the
  // user's enable/disable set). The lens then hides boards that don't apply to the
  // current transaction mode — the sale-only investor boards (cap rate, capital burn,
  // suite) drop out in "For Rent" mode, where the rental-native boards adapt in place.
  // This one array feeds both the built-in city sections and the saved bubble sections.
  const lensScope = config.marketActivity.transactionType;
  const enabledBoards = orderBoardsForPersona(config.persona, config.boards)
    .map((id) => BOARDS[id])
    .filter(Boolean)
    .filter((b) => b.scopes.includes(lensScope));
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

        {/* Region edits go through addRegion/removeRegion, NOT onChange. Editing
            config.regions directly is what let "Customize Workspace" remove an area from
            the dashboard while its alert row kept emailing, with no UI left to mute it. */}
        {showConfig && (
          <DashboardConfigPanel
            config={config}
            onChange={update}
            onAddRegion={addRegion}
            onRemoveRegion={removeRegion}
          />
        )}

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
            className="terminal-font inline-flex min-h-[44px] items-center gap-1.5 border border-border bg-card px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-cyan-600/60 hover:text-foreground dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
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
            // Clear only the property filters; keep the chosen time window and sale/lease.
            onClearFilters={() =>
              updateLens({
                ...config.marketActivity,
                propertyTypes: [],
                minBeds: 0,
                bedsExact: false,
                minBaths: 0,
                bathsExact: false,
                minGarage: 0,
                garageExact: false,
                basement: "any",
                minFrontage: 0,
              })
            }
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

        {/* City sections used to run straight on from the bubbles with no band label of
            their own, so a city read as one more saved bubble — while carrying none of a
            bubble's chrome (no icon, no subtitle, no Terminal link, a different bell).
            Its own rule says which object this is; the icon lines the rows up. */}
        {hasRegions && (
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h2 className="terminal-font flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 text-cyan-700 dark:text-cyan-400" />
              My Cities
            </h2>
          </div>
        )}

        {hasRegions &&
          config.regions.map((loc, i) => {
            const area = regionArea(loc);
            return (
              // The bell mirrors the per-bubble alert toggle: city sections are
              // localStorage-only, so it materializes an area_type 'city' bubble row
              // the nightly worker can deliver against (see CityAlertBell).
              <RegionDrilldown
                key={loc}
                title={formatRegionLabel(loc)}
                persistKey={`city:${loc}`}
                autoOpenFirstRun={i === 0 && cityMayAutoOpen}
                summary={sectionSummary(config.marketActivity, enabledBoards.length)}
                icon={
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-600/15 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300">
                    <Building2 className="h-4 w-4" />
                  </div>
                }
                mobileDetail={
                  <CityAlertBell city={loc} lens={config.marketActivity} variant="detail" />
                }
                actions={<CityAlertBell city={loc} lens={config.marketActivity} />}
              >
                <MarketActivityPanel area={area} lens={config.marketActivity} />

                {enabledBoards.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No boards enabled — add metrics via Customize.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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

        {/* Region intelligence: neighbourhood leaderboard + price trend. A shared city
            switcher (rendered inside each tile when >1 region) keeps them in sync. */}
        {hasRegions && (
          <NeighbourhoodLeaderboard
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
          MLS®.{" "}
          <Link href="/operated-by" className="underline underline-offset-2 hover:text-foreground">
            Operated under licence
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
