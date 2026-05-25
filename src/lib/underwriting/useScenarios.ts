"use client";

/**
 * Saved underwriting scenarios store (Zustand) — dual-path, mirrors useWatchlist.
 *
 * - Signed in  → source of truth is Supabase (`/api/underwriting`, RLS-scoped).
 * - Anonymous  → falls back to localStorage (`pp_scenarios`, a map keyed by listing_key).
 * - On sign-in → anonymously-saved scenarios are pushed to the account once, then
 *   localStorage is cleared. Anonymous-first, but accounts sync across devices.
 *
 * Scenarios are scoped per listing; call `load(listingKey)` when a listing mounts.
 */

import { create } from "zustand";
import { createClient } from "@/lib/supabase/browser";
import type { UnderwritingAssumptions } from "./computeUnderwriting";

const LS_KEY = "pp_scenarios";

export interface Scenario {
  id: string;
  listing_key: string;
  name: string;
  assumptions: UnderwritingAssumptions;
  created_at?: string;
  updated_at?: string;
}

type ByListing = Record<string, Scenario[]>;

function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `local_${crypto.randomUUID()}`;
  return `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function readLocal(): ByListing {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as ByListing) : {};
  } catch {
    return {};
  }
}

function writeLocal(map: ByListing): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / serialization errors */
  }
}

async function migrateLocalToServer(): Promise<void> {
  const map = readLocal();
  const all = Object.values(map).flat();
  if (!all.length) return;
  try {
    for (const s of all) {
      await fetch("/api/underwriting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_key: s.listing_key, name: s.name, assumptions: s.assumptions }),
      });
    }
    writeLocal({});
  } catch {
    /* keep local copy; retried on next sign-in */
  }
}

interface ScenarioState {
  byListing: ByListing;
  signedIn: boolean;
  initialized: boolean;
  loadingKey: string | null;
  init: () => Promise<void>;
  load: (listingKey: string) => Promise<void>;
  save: (
    listingKey: string,
    name: string,
    assumptions: UnderwritingAssumptions
  ) => Promise<Scenario | null>;
  remove: (listingKey: string, id: string) => Promise<void>;
}

export const useScenariosStore = create<ScenarioState>((set, get) => ({
  byListing: {},
  signedIn: false,
  initialized: false,
  loadingKey: null,

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await migrateLocalToServer();
      set({ signedIn: true });
    } else {
      set({ byListing: readLocal(), signedIn: false });
    }

    // Keep in sync with auth changes. Only fetch() inside — never a supabase method.
    supabase.auth.onAuthStateChange(async (event) => {
      if (event === "SIGNED_IN") {
        await migrateLocalToServer();
        set({ signedIn: true, byListing: {} });
      } else if (event === "SIGNED_OUT") {
        set({ byListing: readLocal(), signedIn: false });
      }
    });
  },

  load: async (listingKey) => {
    if (!listingKey) return;
    if (!get().initialized) await get().init();

    if (!get().signedIn) {
      set({ byListing: { ...get().byListing, [listingKey]: readLocal()[listingKey] ?? [] } });
      return;
    }

    set({ loadingKey: listingKey });
    try {
      const res = await fetch(
        `/api/underwriting?listing_key=${encodeURIComponent(listingKey)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(String(res.status));
      const { scenarios } = (await res.json()) as { scenarios: Scenario[] };
      set({ byListing: { ...get().byListing, [listingKey]: scenarios ?? [] } });
    } catch {
      set({ byListing: { ...get().byListing, [listingKey]: get().byListing[listingKey] ?? [] } });
    } finally {
      set({ loadingKey: null });
    }
  },

  save: async (listingKey, name, assumptions) => {
    const trimmed = name.trim().slice(0, 120);
    if (!listingKey || !trimmed) return null;
    const existing = get().byListing[listingKey] ?? [];

    if (get().signedIn) {
      try {
        const res = await fetch("/api/underwriting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listing_key: listingKey, name: trimmed, assumptions }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { scenario } = (await res.json()) as { scenario: Scenario };
        const next = [scenario, ...existing.filter((s) => s.name !== trimmed)];
        set({ byListing: { ...get().byListing, [listingKey]: next } });
        return scenario;
      } catch {
        return null;
      }
    }

    // Anonymous: upsert by name into localStorage.
    const prior = existing.find((s) => s.name === trimmed);
    const scenario: Scenario = {
      id: prior?.id ?? genId(),
      listing_key: listingKey,
      name: trimmed,
      assumptions,
      created_at: prior?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const next = [scenario, ...existing.filter((s) => s.name !== trimmed)];
    const map = { ...readLocal(), [listingKey]: next };
    writeLocal(map);
    set({ byListing: { ...get().byListing, [listingKey]: next } });
    return scenario;
  },

  remove: async (listingKey, id) => {
    const existing = get().byListing[listingKey] ?? [];
    const next = existing.filter((s) => s.id !== id);
    set({ byListing: { ...get().byListing, [listingKey]: next } }); // optimistic

    if (get().signedIn && !id.startsWith("local_")) {
      try {
        await fetch(`/api/underwriting?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch {
        set({ byListing: { ...get().byListing, [listingKey]: existing } }); // revert
      }
    } else {
      const map = { ...readLocal(), [listingKey]: next };
      writeLocal(map);
    }
  },
}));
