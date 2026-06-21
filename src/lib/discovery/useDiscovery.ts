/**
 * useDiscovery — the state behind the in-app feature-discovery system.
 *
 * Holds two kinds of state:
 *  • Durable (persisted to localStorage `pp_discovery`, same convention as
 *    pp_dashboard_config / pp_alerts_seen): what the user has *seen* in the guide,
 *    what they've actually *used* (mastery), and which first-run tours/nudges
 *    they've already cleared.
 *  • Ephemeral (in-memory only): whether the Feature Guide is open, and the
 *    currently-running spotlight/tour.
 *
 * SSR-safe: the store starts empty on the server and is hydrated from
 * localStorage by <DiscoveryRoot/> on mount, mirroring WatchlistInit. Every
 * durable mutation writes straight back through `persist()`.
 */

"use client";

import { create } from "zustand";

const STORE_KEY = "pp_discovery";

export type GuideTab = "page" | "new" | "all";

/** An active spotlight run: an ordered list of feature ids + a cursor. */
export interface SpotlightRun {
  /** Feature ids (resolved against the registry by the Spotlight component). */
  steps: string[];
  index: number;
  /** true → a multi-step first-run tour (records tour-done on finish). */
  isTour: boolean;
  /** Surface a tour belongs to, so finishing marks the right tour done. */
  surface?: string;
}

interface DurableState {
  /** featureId → epoch ms first surfaced to the user (clears the What's-New badge). */
  seen: Record<string, number>;
  /** featureId → epoch ms the user first actually used it (mastery meter). */
  used: Record<string, number>;
  /** surface → epoch ms the first-run tour was completed or skipped. */
  toursDone: Record<string, number>;
  /** surface → epoch ms the first-run nudge was dismissed (so it doesn't re-show). */
  nudgesDone: Record<string, number>;
}

interface DiscoveryState extends DurableState {
  hydrated: boolean;
  guideOpen: boolean;
  guideTab: GuideTab;
  run: SpotlightRun | null;

  hydrate: () => void;
  markSeen: (ids: string | string[]) => void;
  markUsed: (id: string) => void;
  markTourDone: (surface: string) => void;
  dismissNudge: (surface: string) => void;

  openGuide: (tab?: GuideTab) => void;
  closeGuide: () => void;
  setGuideTab: (tab: GuideTab) => void;

  /** Start a spotlight run (single feature or a tour). */
  startRun: (steps: string[], opts?: { isTour?: boolean; surface?: string }) => void;
  /** Convenience: spotlight exactly one feature ("Show me"). */
  showFeature: (id: string) => void;
  runNext: () => void;
  runPrev: () => void;
  endRun: () => void;
}

const EMPTY_DURABLE: DurableState = {
  seen: {},
  used: {},
  toursDone: {},
  nudgesDone: {},
};

function readDurable(): DurableState {
  if (typeof window === "undefined") return { ...EMPTY_DURABLE };
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { ...EMPTY_DURABLE };
    const p = JSON.parse(raw) as Partial<DurableState>;
    return {
      seen: p.seen && typeof p.seen === "object" ? p.seen : {},
      used: p.used && typeof p.used === "object" ? p.used : {},
      toursDone: p.toursDone && typeof p.toursDone === "object" ? p.toursDone : {},
      nudgesDone: p.nudgesDone && typeof p.nudgesDone === "object" ? p.nudgesDone : {},
    };
  } catch {
    return { ...EMPTY_DURABLE };
  }
}

function writeDurable(d: DurableState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(d));
  } catch {
    /* quota / private mode — ignore, discovery is best-effort */
  }
}

export const useDiscovery = create<DiscoveryState>((set, get) => {
  // Persist the durable slice after any mutation that touches it.
  const persist = () => {
    const { seen, used, toursDone, nudgesDone } = get();
    writeDurable({ seen, used, toursDone, nudgesDone });
  };

  return {
    ...EMPTY_DURABLE,
    hydrated: false,
    guideOpen: false,
    guideTab: "page",
    run: null,

    hydrate: () => {
      if (get().hydrated) return;
      set({ ...readDurable(), hydrated: true });
    },

    markSeen: (ids) => {
      const list = Array.isArray(ids) ? ids : [ids];
      if (list.length === 0) return;
      const now = Date.now();
      const seen = { ...get().seen };
      let changed = false;
      for (const id of list) {
        if (seen[id] === undefined) {
          seen[id] = now;
          changed = true;
        }
      }
      if (!changed) return;
      set({ seen });
      persist();
    },

    markUsed: (id) => {
      if (get().used[id] !== undefined) return;
      set({ used: { ...get().used, [id]: Date.now() } });
      persist();
    },

    markTourDone: (surface) => {
      if (get().toursDone[surface] !== undefined) return;
      set({ toursDone: { ...get().toursDone, [surface]: Date.now() } });
      persist();
    },

    dismissNudge: (surface) => {
      if (get().nudgesDone[surface] !== undefined) return;
      set({ nudgesDone: { ...get().nudgesDone, [surface]: Date.now() } });
      persist();
    },

    openGuide: (tab) => set({ guideOpen: true, guideTab: tab ?? get().guideTab }),
    closeGuide: () => set({ guideOpen: false }),
    setGuideTab: (tab) => set({ guideTab: tab }),

    startRun: (steps, opts) => {
      if (steps.length === 0) return;
      set({
        run: { steps, index: 0, isTour: opts?.isTour ?? false, surface: opts?.surface },
        guideOpen: false,
      });
    },

    showFeature: (id) => get().startRun([id], { isTour: false }),

    runNext: () => {
      const run = get().run;
      if (!run) return;
      if (run.index >= run.steps.length - 1) {
        get().endRun();
        return;
      }
      set({ run: { ...run, index: run.index + 1 } });
    },

    runPrev: () => {
      const run = get().run;
      if (!run || run.index === 0) return;
      set({ run: { ...run, index: run.index - 1 } });
    },

    endRun: () => {
      const run = get().run;
      if (!run) return;
      // Finishing a run acknowledges every feature it covered…
      get().markSeen(run.steps);
      // …and a tour records itself done so it never auto-offers again.
      if (run.isTour && run.surface) get().markTourDone(run.surface);
      set({ run: null });
    },
  };
});
