/**
 * DiscoveryRoot — the single client entry-point for the whole discovery system,
 * mounted once in the root layout so it covers every page (public + app).
 *
 * Responsibilities:
 *  • Hydrate the persisted discovery state from localStorage (like WatchlistInit).
 *  • Render the floating launcher (with a What's-New count badge) and wire the
 *    global `?` hotkey to open the Feature Guide.
 *  • Offer a gentle, persona-aware first-run tour on the high-value surfaces
 *    (the terminal, a listing, the dashboard) — a small dismissible nudge, never
 *    an auto-hijack of the page.
 *  • Host the <FeatureGuide/> and <Spotlight/> overlays (they self-hide).
 */

"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X, Compass, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useDiscovery } from "@/lib/discovery/useDiscovery";
import {
  surfaceForPath,
  tourForSurface,
  newFeatures,
  TOUR_SURFACES,
} from "@/lib/discovery/featureRegistry";
import { getConfig } from "@/lib/dashboard/config";
import type { PersonaType } from "@/lib/personas/personaConfig";
import FeatureGuide from "@/components/discovery/FeatureGuide";
import Spotlight from "@/components/discovery/Spotlight";

export default function DiscoveryRoot() {
  const hydrate = useDiscovery((s) => s.hydrate);
  const hydrated = useDiscovery((s) => s.hydrated);
  const openGuide = useDiscovery((s) => s.openGuide);
  const guideOpen = useDiscovery((s) => s.guideOpen);
  const run = useDiscovery((s) => s.run);
  const seen = useDiscovery((s) => s.seen);
  const toursDone = useDiscovery((s) => s.toursDone);
  const nudgesDone = useDiscovery((s) => s.nudgesDone);
  const startRun = useDiscovery((s) => s.startRun);
  const dismissNudge = useDiscovery((s) => s.dismissNudge);

  const pathname = usePathname() || "/";
  const surface = surfaceForPath(pathname);
  const isMobile = useIsMobile();

  // Hydrate once on mount.
  React.useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Global `?` opens the guide (ignored while typing or when an overlay is up).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (useDiscovery.getState().guideOpen || useDiscovery.getState().run) return;
      e.preventDefault();
      openGuide("page");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openGuide]);

  // First-run nudge: eligible when on a tour surface the user hasn't toured or
  // dismissed yet. Small delay lets the page paint first.
  const [nudge, setNudge] = React.useState(false);
  const eligible =
    hydrated &&
    // The terminal's mobile bottom strip (List/Map toggle, Tools launcher, and the
    // map's property-card popup) is too dense for this bottom-left nudge to sit over
    // without blocking taps — skip the first-run nudge there on phones. The Guide
    // launcher still offers the tour, and desktop is unaffected.
    !(surface === "terminal" && isMobile) &&
    TOUR_SURFACES.includes(surface) &&
    toursDone[surface] === undefined &&
    nudgesDone[surface] === undefined &&
    tourForSurface(surface, getConfig().persona).length > 0;

  React.useEffect(() => {
    setNudge(false);
    if (!eligible) return;
    const id = window.setTimeout(() => setNudge(true), 1200);
    return () => window.clearTimeout(id);
  }, [eligible, surface]);

  const unseenNew = hydrated
    ? newFeatures().filter((f) => seen[f.id] === undefined).length
    : 0;

  const startTour = () => {
    const persona: PersonaType = getConfig().persona;
    const steps = tourForSurface(surface, persona).map((f) => f.id);
    setNudge(false);
    dismissNudge(surface);
    startRun(steps, { isTour: true, surface });
  };

  const overlayUp = guideOpen || !!run;

  return (
    <>
      <FeatureGuide />
      <Spotlight />

      {/* First-run nudge — bottom-left so it never collides with the launcher. */}
      {nudge && !overlayUp && (
        <div className="pp-fade-up fixed left-4 z-[140] w-[min(20rem,calc(100vw-2rem))] border border-cyan-500/40 bg-slate-900 p-4 shadow-2xl [bottom:max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => {
              setNudge(false);
              dismissNudge(surface);
            }}
            aria-label="Dismiss"
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center text-slate-500 transition-colors hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start gap-2.5 pr-6">
            <Compass className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
            <div>
              <p className="text-sm font-semibold text-slate-100">New here? Take the 30-second tour</p>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-400">
                A quick, skippable walkthrough of the tools on this screen — tailored to how you invest.
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setNudge(false);
                dismissNudge(surface);
              }}
              className="px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
            >
              Maybe later
            </button>
            <button
              type="button"
              onClick={startTour}
              className="inline-flex items-center gap-1.5 border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
            >
              Start tour <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Floating launcher — hidden while an overlay is open. */}
      {!overlayUp && (
        <button
          type="button"
          onClick={() => openGuide("page")}
          aria-label="Open feature guide"
          className={cn(
            "fixed right-4 z-[130] inline-flex items-center gap-2 border border-slate-700 bg-slate-900/95 px-3 py-2.5 text-slate-200 shadow-xl backdrop-blur transition-colors hover:border-cyan-500/60 hover:text-cyan-200",
            "[bottom:max(1.25rem,env(safe-area-inset-bottom))]"
          )}
        >
          <Sparkles className="h-4 w-4 text-cyan-300" />
          <span className="terminal-font hidden text-[11px] font-semibold uppercase tracking-wider sm:inline">
            Guide
          </span>
          {unseenNew > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[10px] font-bold text-white">
              {unseenNew > 9 ? "9+" : unseenNew}
            </span>
          )}
        </button>
      )}
    </>
  );
}
