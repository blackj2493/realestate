/**
 * useInstallPrompt — the state behind "add PureProperty to your home screen".
 *
 * Holds Chrome's deferred `beforeinstallprompt` event (captured at module load, before
 * React mounts, so it is never missed), the durable per-device record (localStorage
 * `pp_pwa_install`, same convention as pp_discovery / pp_dashboard_config), and the
 * open state of the iOS how-to sheet.
 *
 * SSR-safe: the store starts empty on the server and is hydrated by <PwaRoot/> on
 * mount, mirroring useDiscovery. Every durable mutation writes straight back.
 */

"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { track } from "@/lib/analytics/posthog";
import {
  detectInstallPlatform,
  parseInstallState,
  EMPTY_INSTALL_STATE,
  STORE_KEY,
  type InstallPlatform,
  type InstallState,
} from "./installPlatform";

/** Chrome's non-standard install event — not in lib.dom. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** Where an install action was started from (analytics). */
export type InstallSource = "nudge" | "menu";

const VISIT_FLAG = "pp_pwa_visit";

/** Running from the home screen? Chrome/Android via display-mode; iOS via navigator.standalone. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    /* matchMedia missing — fall through */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function currentPlatform(hasNativePrompt: boolean): InstallPlatform {
  if (typeof navigator === "undefined") return "unsupported";
  return detectInstallPlatform({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: isStandaloneDisplay(),
    hasNativePrompt,
  });
}

function writeDurable(d: InstallState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(d));
  } catch {
    /* quota / private mode — install prompting is best-effort */
  }
}

interface InstallPromptState extends InstallState {
  hydrated: boolean;
  /** The held Chrome event, usable exactly once. */
  deferred: BeforeInstallPromptEvent | null;
  standalone: boolean;
  iosSheetOpen: boolean;
  /**
   * Where a native install stands, for the confirmation toast. Chrome's dialog closes the
   * moment the user taps "Install", but on Android the home-screen icon (a WebAPK) can take
   * several seconds to land, and nothing on the page said so — the user had to go and look.
   */
  installStage: "idle" | "installing" | "installed";

  hydrate: () => void;
  /** Open Chrome's native install dialog. Resolves to what the user chose. */
  promptInstall: (source: InstallSource) => Promise<"accepted" | "dismissed" | "unavailable">;
  /** "Not now" — keeps the nudge away for NUDGE_SNOOZE_MS. */
  snooze: () => void;
  openIosSheet: (source: InstallSource) => void;
  closeIosSheet: () => void;
}

export const useInstallPrompt = create<InstallPromptState>((set, get) => {
  const persist = () => {
    const { visits, dismissedAt, installedAt } = get();
    writeDurable({ visits, dismissedAt, installedAt });
  };

  return {
    ...EMPTY_INSTALL_STATE,
    hydrated: false,
    deferred: null,
    standalone: false,
    iosSheetOpen: false,
    installStage: "idle",

    hydrate: () => {
      if (get().hydrated || typeof window === "undefined") return;
      let durable: InstallState = { ...EMPTY_INSTALL_STATE };
      try {
        durable = parseInstallState(window.localStorage.getItem(STORE_KEY));
      } catch {
        /* storage blocked — treat as a first visit */
      }
      const standalone = isStandaloneDisplay();
      // A standalone launch is proof of install — iOS never fires `appinstalled`, so this
      // is the only way an iPhone user stops being nudged in the browser tab later.
      if (standalone && durable.installedAt === null) durable.installedAt = Date.now();
      // One bump per tab session, so a reload doesn't count as a return visit.
      try {
        if (!window.sessionStorage.getItem(VISIT_FLAG)) {
          window.sessionStorage.setItem(VISIT_FLAG, "1");
          durable.visits += 1;
        }
      } catch {
        /* no sessionStorage — count the load anyway */
        durable.visits += 1;
      }
      set({ ...durable, standalone, hydrated: true });
      persist();
    },

    promptInstall: async (source) => {
      const ev = get().deferred;
      const platform = currentPlatform(ev !== null);
      if (!ev) return "unavailable";
      // The event is single-use; drop it before prompting so a double-tap can't re-fire.
      set({ deferred: null });
      track("pwa_install_prompted", { platform, source });
      try {
        await ev.prompt();
        const { outcome } = await ev.userChoice;
        track("pwa_install_outcome", { platform, source, outcome });
        if (outcome === "accepted") set({ installStage: "installing" });
        if (outcome === "dismissed") get().snooze();
        return outcome;
      } catch {
        return "unavailable";
      }
    },

    snooze: () => {
      set({ dismissedAt: Date.now() });
      persist();
    },

    openIosSheet: (source) => {
      track("pwa_install_prompted", { platform: "ios", source });
      // Showing the steps counts as the ask; the nudge stays away for the snooze window.
      set({ iosSheetOpen: true, dismissedAt: Date.now() });
      persist();
    },

    closeIosSheet: () => set({ iosSheetOpen: false }),
  };
});

// Capture at module load — the event can fire before any component mounts.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Suppress Chrome's own mini-infobar; we offer install from our nudge and the menu.
    e.preventDefault();
    useInstallPrompt.setState({ deferred: e as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => {
    const s = useInstallPrompt.getState();
    track("pwa_installed", { platform: currentPlatform(false) });
    useInstallPrompt.setState({ deferred: null, installedAt: s.installedAt ?? Date.now(), installStage: "installed" });
    const { visits, dismissedAt, installedAt } = useInstallPrompt.getState();
    writeDurable({ visits, dismissedAt, installedAt });
  });
}

/** The platform this device can install on, or "unsupported" until hydrated. */
export function useInstallPlatform(): InstallPlatform {
  const hydrated = useInstallPrompt((s) => s.hydrated);
  const hasNativePrompt = useInstallPrompt((s) => s.deferred !== null);
  const standalone = useInstallPrompt((s) => s.standalone);
  const installedAt = useInstallPrompt((s) => s.installedAt);
  return useMemo(() => {
    if (!hydrated) return "unsupported";
    if (standalone || installedAt !== null) return "installed";
    return currentPlatform(hasNativePrompt);
  }, [hydrated, standalone, installedAt, hasNativePrompt]);
}
