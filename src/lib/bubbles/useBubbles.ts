"use client";

/**
 * Saved market bubbles store (Zustand).
 *
 * Sign-in gated: unlike the watchlist, there is NO anonymous localStorage path.
 * For anon users the store stays empty; the SaveBubbleButton triggers the
 * magic-link auth modal and stashes its pending payload in sessionStorage so
 * the save resumes once auth completes (see consumePendingBubble below).
 *
 * Mirrors the auth-lifecycle pattern from src/lib/watchlist/useWatchlist.ts.
 */

import { create } from "zustand";
import { createClient } from "@/lib/supabase/browser";
import type { Bubble, BubblePayload } from "./serialize";

const PENDING_KEY = "pp_pending_bubble";

type BubbleMap = Record<string, Bubble>;

function toMap(items: Bubble[]): BubbleMap {
  const m: BubbleMap = {};
  for (const b of items) if (b?.id) m[b.id] = b;
  return m;
}

interface BubbleState {
  items: BubbleMap;
  signedIn: boolean;
  loaded: boolean;
  initialized: boolean;
  init: () => Promise<void>;
  create: (payload: BubblePayload) => Promise<Bubble | { error: string }>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Toggle the nightly new-listing digest for one bubble (optimistic). */
  setAlertsEnabled: (id: string, enabled: boolean) => Promise<void>;
}

export const useBubblesStore = create<BubbleState>((set, get) => ({
  items: {},
  signedIn: false,
  loaded: false,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });

    const supabase = createClient();

    const loadServer = async () => {
      try {
        const res = await fetch("/api/bubbles", { cache: "no-store" });
        if (!res.ok) {
          set({ signedIn: true, loaded: true });
          return;
        }
        const { items } = (await res.json()) as { items: Bubble[] };
        set({ items: toMap(items ?? []), signedIn: true, loaded: true });
      } catch {
        set({ signedIn: true, loaded: true });
      }
    };

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await loadServer();
    } else {
      set({ items: {}, signedIn: false, loaded: true });
    }

    supabase.auth.onAuthStateChange(async (event) => {
      if (event === "SIGNED_IN") await loadServer();
      else if (event === "SIGNED_OUT") set({ items: {}, signedIn: false });
    });
  },

  create: async (payload) => {
    try {
      const res = await fetch("/api/bubbles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        return { error: error ?? `Save failed (${res.status})` };
      }
      const { item } = (await res.json()) as { item: Bubble };
      set((s) => ({ items: { ...s.items, [item.id]: item } }));
      return item;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Network error" };
    }
  },

  rename: async (id, name) => {
    const prev = get().items[id];
    if (!prev) return;
    set((s) => ({ items: { ...s.items, [id]: { ...prev, name } } }));
    try {
      const res = await fetch(`/api/bubbles/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) set((s) => ({ items: { ...s.items, [id]: prev } }));
    } catch {
      set((s) => ({ items: { ...s.items, [id]: prev } }));
    }
  },

  setAlertsEnabled: async (id, enabled) => {
    const prev = get().items[id];
    if (!prev) return;
    set((s) => ({ items: { ...s.items, [id]: { ...prev, alerts_enabled: enabled } } }));
    try {
      const res = await fetch(`/api/bubbles/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alerts_enabled: enabled }),
      });
      if (!res.ok) set((s) => ({ items: { ...s.items, [id]: prev } }));
    } catch {
      set((s) => ({ items: { ...s.items, [id]: prev } }));
    }
  },

  remove: async (id) => {
    const prev = get().items[id];
    if (!prev) return;
    const next = { ...get().items };
    delete next[id];
    set({ items: next });
    try {
      const res = await fetch(`/api/bubbles/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) set((s) => ({ items: { ...s.items, [id]: prev } }));
    } catch {
      set((s) => ({ items: { ...s.items, [id]: prev } }));
    }
  },
}));

// ──────────────────────────────────────────────────────────────────────────
// Auth-gate handoff: stash a payload in sessionStorage across a magic-link
// round-trip, then replay it after the user signs in.
// ──────────────────────────────────────────────────────────────────────────

export function stashPendingBubble(payload: BubblePayload): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

export function readPendingBubble(): BubblePayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as BubblePayload) : null;
  } catch {
    return null;
  }
}

export function clearPendingBubble(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Call from the post-magic-link landing screen (or any auth-success surface).
 * If a pending bubble payload is stashed, save it now and return it.
 */
export async function consumePendingBubble(): Promise<Bubble | null> {
  const pending = readPendingBubble();
  if (!pending) return null;
  const result = await useBubblesStore.getState().create(pending);
  if ("error" in result) return null;
  clearPendingBubble();
  return result;
}
