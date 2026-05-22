/**
 * Command Center Zustand Store
 * Single source of truth for the persona-driven 100vh terminal (CLAUDE.md §3B).
 */

import { create } from "zustand";
import type { ListingDocument, SearchResult } from "@/lib/typesense/client";
import {
  type PersonaType,
  type TerminalFilterState,
  defaultTerminalFilters,
} from "@/lib/personas/personaConfig";

export type { PersonaType } from "@/lib/personas/personaConfig";

export type CommuteMode = "driving" | "walking" | "cycling";

export interface CommuteState {
  enabled: boolean;
  destination: { label: string; lat: number; lng: number } | null;
  mode: CommuteMode;
  minutes: number;
  /** Isochrone outer ring in GeoJSON [lng, lat] order (deck.gl-ready). */
  polygon: [number, number][] | null;
}

const defaultCommute: CommuteState = {
  enabled: false,
  destination: null,
  mode: "driving",
  minutes: 20,
  polygon: null,
};

export interface CommandCenterState {
  // Persona
  activePersona: PersonaType;
  setActivePersona: (persona: PersonaType) => void;

  // Filters (flat; each persona reads its relevant subset)
  filters: TerminalFilterState;
  setFilter: <K extends keyof TerminalFilterState>(
    key: K,
    value: TerminalFilterState[K]
  ) => void;
  resetFilters: () => void;

  // Selected property for the detail terminal
  selectedProperty: ListingDocument | null;
  setSelectedProperty: (property: ListingDocument | null) => void;
  isTerminalOpen: boolean;
  setIsTerminalOpen: (open: boolean) => void;

  // Hovered listing id — synced between map pins and ledger rows
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;

  // Search results
  searchResult: SearchResult | null;
  setSearchResult: (result: SearchResult | null) => void;

  // UI state
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;

  // Location query
  location: string;
  setLocation: (location: string) => void;

  // Commute-time filter (global, applies across personas)
  commute: CommuteState;
  setCommute: (patch: Partial<CommuteState>) => void;
  setCommutePolygon: (polygon: [number, number][] | null) => void;
  resetCommute: () => void;

  // Total found (full count, independent of the ≤100 render cap)
  totalCount: number;
  setTotalCount: (count: number) => void;
}

export const useCommandCenterStore = create<CommandCenterState>((set) => ({
  activePersona: "smart",
  setActivePersona: (persona) => set({ activePersona: persona }),

  filters: { ...defaultTerminalFilters },
  setFilter: (key, value) =>
    set((state) => ({ filters: { ...state.filters, [key]: value } })),
  resetFilters: () =>
    set({ filters: { ...defaultTerminalFilters }, commute: { ...defaultCommute } }),

  selectedProperty: null,
  setSelectedProperty: (property) =>
    set({ selectedProperty: property, isTerminalOpen: property !== null }),
  isTerminalOpen: false,
  setIsTerminalOpen: (open) =>
    set((state) => ({
      isTerminalOpen: open,
      selectedProperty: open ? state.selectedProperty : null,
    })),

  hoveredId: null,
  setHoveredId: (id) => set({ hoveredId: id }),

  searchResult: null,
  setSearchResult: (result) => set({ searchResult: result }),

  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  error: null,
  setError: (error) => set({ error }),

  location: "",
  setLocation: (location) => set({ location }),

  commute: { ...defaultCommute },
  setCommute: (patch) =>
    set((state) => ({ commute: { ...state.commute, ...patch } })),
  setCommutePolygon: (polygon) =>
    set((state) => ({ commute: { ...state.commute, polygon } })),
  resetCommute: () => set({ commute: { ...defaultCommute } }),

  totalCount: 0,
  setTotalCount: (count) => set({ totalCount: count }),
}));
