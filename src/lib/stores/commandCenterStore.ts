/**
 * Command Center Zustand Store
 * Single source of truth for the persona-driven 100vh terminal (CLAUDE.md §3B).
 */

import { create } from "zustand";
import type { ListingDocument, SearchResult } from "@/lib/typesense/client";
import {
  type PersonaType,
  type TerminalFilterState,
  type MapMode,
  defaultTerminalFilters,
} from "@/lib/personas/personaConfig";

export type { PersonaType } from "@/lib/personas/personaConfig";

export type CommuteMode = "driving" | "walking" | "cycling";

/**
 * Instrument Deck — which rail module's drawer is open (null = none). Only one
 * drawer is open at a time so the map is never buried under stacked panels.
 */
export type RailModule = "layers" | "color" | "draw" | "compare" | "time" | "lenses";

/** Current map viewport extent, used to scope the search to what's on screen. */
export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

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

export type SchoolLevel = "elementary" | "secondary";
export type SchoolSystem = "public" | "catholic" | "either";

/**
 * School-quality lens (global, applies across personas). The Level×System pair
 * resolves to one indexed Typesense score field (see schoolScoreField) that drives
 * the min-score filter, the sort, and the map shading. `targetSchool` adds a
 * proximity filter to a specific school (NearbySchools:=id).
 */
export interface SchoolState {
  enabled: boolean;
  level: SchoolLevel;
  system: SchoolSystem;
  minScore: number; // 0–10; 0 = no score filter (sort/shade only)
  targetSchool: { id: string; name: string } | null;
}

const defaultSchool: SchoolState = {
  enabled: false,
  level: "elementary",
  system: "public",
  minScore: 0,
  targetSchool: null,
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

  // Multi-select — chosen listing ids (id = ListingKey), shared by map + ledger
  selectedIds: Set<string>;
  toggleSelected: (id: string) => void;
  clearSelected: () => void;
  // Map tap-to-select mode: when on, clicking a pin toggles selection
  isSelectMode: boolean;
  setSelectMode: (on: boolean) => void;
  // Collapse both panes to just the current selection
  showSelectedOnly: boolean;
  setShowSelectedOnly: (on: boolean) => void;

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

  // School-quality lens (global, applies across personas)
  school: SchoolState;
  setSchool: (patch: Partial<SchoolState>) => void;
  resetSchool: () => void;

  // Total found (full count, independent of the ≤100 render cap)
  totalCount: number;
  setTotalCount: (count: number) => void;

  // Current map viewport (null = whole-zone, no bounding-box constraint)
  mapBounds: MapBounds | null;
  setMapBounds: (bounds: MapBounds | null) => void;

  // Map render mode (Instrument Deck mode dock). Lifted out of AlphaMap so the
  // rail/dock can drive it. Reset to the persona default on persona change.
  mapMode: MapMode;
  setMapMode: (mode: MapMode) => void;

  // Which rail module's drawer is open (null = closed). One at a time.
  activeModule: RailModule | null;
  setActiveModule: (module: RailModule | null) => void;
  toggleModule: (module: RailModule) => void;

  // "Color By" — id of the chosen map metric (null = persona/school default).
  colorMetricId: string | null;
  setColorMetricId: (id: string | null) => void;

  // Selected legend band (the metric it belongs to + bucket index). Clicking a
  // band filters the map to that value range; switching metrics clears it.
  colorBand: { metricId: string; index: number } | null;
  setColorBand: (band: { metricId: string; index: number } | null) => void;

  // Draw-to-search: a freehand polygon area filter. Points are placed by clicking
  // the map while isDrawing; finishing (≥3 points) commits drawPolygon, which the
  // search composes with commute/viewport as an extra geo filter. [lng, lat] order.
  isDrawing: boolean;
  drawPoints: [number, number][];
  drawPolygon: [number, number][] | null;
  startDrawing: () => void;
  addDrawPoint: (point: [number, number]) => void;
  undoDrawPoint: () => void;
  finishDrawing: () => void;
  clearDraw: () => void;
}

export const useCommandCenterStore = create<CommandCenterState>((set) => ({
  activePersona: "smart",
  setActivePersona: (persona) => set({ activePersona: persona }),

  filters: { ...defaultTerminalFilters },
  setFilter: (key, value) =>
    set((state) => ({ filters: { ...state.filters, [key]: value } })),
  resetFilters: () =>
    set({
      filters: { ...defaultTerminalFilters },
      commute: { ...defaultCommute },
      school: { ...defaultSchool },
    }),

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

  selectedIds: new Set<string>(),
  toggleSelected: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Leaving zero selected exits the isolated view so the user isn't stranded.
      return {
        selectedIds: next,
        showSelectedOnly: next.size === 0 ? false : state.showSelectedOnly,
      };
    }),
  clearSelected: () => set({ selectedIds: new Set<string>(), showSelectedOnly: false }),
  isSelectMode: false,
  setSelectMode: (on) => set({ isSelectMode: on }),
  showSelectedOnly: false,
  setShowSelectedOnly: (on) => set({ showSelectedOnly: on }),

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

  school: { ...defaultSchool },
  setSchool: (patch) =>
    set((state) => ({ school: { ...state.school, ...patch } })),
  resetSchool: () => set({ school: { ...defaultSchool } }),

  totalCount: 0,
  setTotalCount: (count) => set({ totalCount: count }),

  mapBounds: null,
  setMapBounds: (bounds) => set({ mapBounds: bounds }),

  mapMode: "listings",
  setMapMode: (mode) => set({ mapMode: mode }),

  activeModule: null,
  setActiveModule: (module) => set({ activeModule: module }),
  toggleModule: (module) =>
    set((state) => ({ activeModule: state.activeModule === module ? null : module })),

  colorMetricId: null,
  // Changing the color metric clears any band selection (it belonged to the old metric).
  setColorMetricId: (id) => set({ colorMetricId: id, colorBand: null }),

  colorBand: null,
  setColorBand: (band) => set({ colorBand: band }),

  isDrawing: false,
  drawPoints: [],
  drawPolygon: null,
  startDrawing: () => set({ isDrawing: true, drawPoints: [], drawPolygon: null }),
  addDrawPoint: (point) => set((state) => ({ drawPoints: [...state.drawPoints, point] })),
  undoDrawPoint: () => set((state) => ({ drawPoints: state.drawPoints.slice(0, -1) })),
  finishDrawing: () =>
    set((state) =>
      state.drawPoints.length >= 3 ? { isDrawing: false, drawPolygon: state.drawPoints } : {}
    ),
  clearDraw: () => set({ isDrawing: false, drawPoints: [], drawPolygon: null }),
}));
