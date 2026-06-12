"use client";

/**
 * Cross-device watchlist store (Zustand).
 *
 * - Signed in  → source of truth is Supabase (`/api/watchlist`, RLS-scoped).
 * - Anonymous  → falls back to localStorage (`pp_watchlist`).
 * - On sign-in → any anonymously-saved items are migrated to the account once,
 *   then localStorage is cleared. This keeps the app anonymous-first while letting
 *   accounts sync the watchlist across devices.
 *
 * Mirrors the localStorage pattern in src/lib/dashboard/recentlyViewed.ts.
 */

import { create } from "zustand";
import { createClient } from "@/lib/supabase/browser";

const LS_KEY = "pp_watchlist";

export interface WatchItem {
  listing_key: string; // == listing id used at /properties/{id}
  address?: string;
  city?: string;
  thumb?: string;
  list_price?: number;
  status?: string;
}

type ItemMap = Record<string, WatchItem>;

function readLocal(): WatchItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as WatchItem[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(items: WatchItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch {
    /* ignore quota / serialization errors */
  }
}

function toMap(items: WatchItem[]): ItemMap {
  const m: ItemMap = {};
  for (const it of items) if (it?.listing_key) m[it.listing_key] = it;
  return m;
}

async function migrateLocalToServer(): Promise<void> {
  const local = readLocal();
  if (!local.length) return;
  try {
    const res = await fetch("/api/watchlist/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: local }),
    });
    if (res.ok) writeLocal([]);
  } catch {
    /* keep local copy; retried on next load */
  }
}

interface WatchState {
  items: ItemMap;
  signedIn: boolean;
  loaded: boolean;
  initialized: boolean;
  init: () => Promise<void>;
  toggle: (item: WatchItem) => Promise<void>;
}

export const useWatchlistStore = create<WatchState>((set, get) => ({
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
        const res = await fetch("/api/watchlist", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const { items } = (await res.json()) as { items: WatchItem[] };
        set({ items: toMap(items ?? []), signedIn: true, loaded: true });
      } catch {
        set({ signedIn: true, loaded: true });
      }
    };

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await migrateLocalToServer();
      await loadServer();
    } else {
      set({ items: toMap(readLocal()), signedIn: false, loaded: true });
    }

    // Keep the store in sync with auth changes (sign-in on another tab, sign-out…).
    // Only fetch() is called inside — never a supabase method — to avoid deadlocks.
    supabase.auth.onAuthStateChange(async (event) => {
      if (event === "SIGNED_IN") {
        await migrateLocalToServer();
        await loadServer();
      } else if (event === "SIGNED_OUT") {
        set({ items: toMap(readLocal()), signedIn: false, loaded: true });
      }
    });
  },

  toggle: async (item) => {
    const key = item.listing_key;
    if (!key) return;

    const prev = get().items;
    const watched = !!prev[key];
    const next: ItemMap = { ...prev };
    if (watched) delete next[key];
    else next[key] = item;
    set({ items: next }); // optimistic

    if (get().signedIn) {
      try {
        if (watched) {
          await fetch(`/api/watchlist?listing_key=${encodeURIComponent(key)}`, {
            method: "DELETE",
          });
        } else {
          await fetch("/api/watchlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          });
        }
      } catch {
        set({ items: prev }); // revert on network failure
      }
    } else {
      writeLocal(Object.values(next));
    }
  },
}));
