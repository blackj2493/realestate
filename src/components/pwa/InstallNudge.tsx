"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { X, Smartphone, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { track } from "@/lib/analytics/posthog";
import { useDiscovery } from "@/lib/discovery/useDiscovery";
import { surfaceForPath, TOUR_SURFACES } from "@/lib/discovery/featureRegistry";
import { shouldShowInstallNudge } from "@/lib/pwa/installPlatform";
import { useInstallPrompt, useInstallPlatform } from "@/lib/pwa/useInstallPrompt";

/**
 * App surfaces where the nudge may appear. Not the hero (the brand's first impression),
 * and not the terminal on phones — its bottom strip is too dense, the same call the
 * discovery tour nudge makes.
 */
const NUDGE_SURFACES = new Set(["dashboard", "listing", "analytics"]);

/**
 * The proactive "add to home screen" card. Phones only, second visit or later, one
 * appearance per month, and never on top of the discovery system's overlays or its
 * first-run nudge (those take the same corner). Android opens Chrome's install dialog;
 * iOS opens the how-to sheet, because Safari has no install API.
 */
export default function InstallNudge() {
  const pathname = usePathname() || "/";
  const surface = surfaceForPath(pathname);
  const isMobile = useIsMobile();
  const platform = useInstallPlatform();

  const hydrated = useInstallPrompt((s) => s.hydrated);
  const visits = useInstallPrompt((s) => s.visits);
  const dismissedAt = useInstallPrompt((s) => s.dismissedAt);
  const promptInstall = useInstallPrompt((s) => s.promptInstall);
  const openIosSheet = useInstallPrompt((s) => s.openIosSheet);
  const snooze = useInstallPrompt((s) => s.snooze);

  const discoveryHydrated = useDiscovery((s) => s.hydrated);
  const overlayUp = useDiscovery((s) => s.guideOpen || s.run !== null || s.chromeBlockers > 0);
  // The discovery first-run nudge is still owed on this surface — let it go first.
  const tourPending = useDiscovery(
    (s) => TOUR_SURFACES.includes(surface) && s.toursDone[surface] === undefined && s.nudgesDone[surface] === undefined
  );

  const eligible =
    hydrated && discoveryHydrated && !overlayUp && !tourPending && NUDGE_SURFACES.has(surface);

  // Same pattern as DiscoveryRoot's nudge: a short delay lets the page paint first.
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    setVisible(false);
    if (!eligible) return;
    if (!shouldShowInstallNudge({ platform, isMobile, visits, dismissedAt, now: Date.now() })) return;
    const id = window.setTimeout(() => setVisible(true), 2500);
    return () => window.clearTimeout(id);
  }, [eligible, platform, isMobile, visits, dismissedAt, surface]);

  // Never a camper: 20s and it hides itself, and that counts as "Not now".
  React.useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(() => {
      setVisible(false);
      snooze();
    }, 20000);
    return () => window.clearTimeout(id);
  }, [visible, snooze]);

  if (!visible) return null;

  const later = () => {
    setVisible(false);
    snooze();
    track("pwa_install_outcome", { platform, source: "nudge", outcome: "snoozed" });
  };
  const install = () => {
    setVisible(false);
    if (platform === "ios") {
      openIosSheet("nudge");
      return;
    }
    void promptInstall("nudge");
  };

  return (
    // `dark` is deliberate: like the discovery nudge, this floats over every page from
    // the root layout and stays one shade rather than restyling per page.
    <div
      role="dialog"
      aria-label="Add PureProperty to your home screen"
      className={cn(
        "dark pp-fade-up fixed left-4 z-[140] w-[min(20rem,calc(100vw-2rem))] border border-cyan-500/40 bg-slate-900 p-4 shadow-2xl",
        // Clears the listing page's sticky action bar instead of covering it.
        "[bottom:max(5.5rem,env(safe-area-inset-bottom))]"
      )}
    >
      <button
        type="button"
        onClick={later}
        aria-label="Dismiss"
        className="absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center text-slate-500 transition-colors hover:text-slate-200"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-2.5 pr-8">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
        <div>
          <p className="text-sm font-semibold text-slate-100">Add PureProperty to your home screen</p>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-400">
            One tap to your dashboard and watchlist, full screen. No app store needed.
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={later}
          className="min-h-[44px] px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300 [touch-action:manipulation]"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={install}
          className="inline-flex min-h-[44px] items-center gap-1.5 border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 active:bg-cyan-500/30 [touch-action:manipulation]"
        >
          {platform === "ios" ? "Show me how" : "Install"} <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
