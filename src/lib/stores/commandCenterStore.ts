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
import type { FilterValue, UniversalFilterState } from "@/lib/filters/types";
import { makeDefaultUniversalFilters } from "@/lib/filters/filterRegistry";
import { type TransactionMode, type PropertyClass, priceConfig } from "@/lib/filters/fundamentals";
import { SOLD_DISPLAY_MAX_DAYS } from "@/lib/sold/config";
import { type LayerKey, transactionModeForLayers, toggleLayer as applyLayerToggle } from "@/lib/sold/layers";
import { SCOPE_DEFAULT_PERSONA } from "@/lib/personas/resolvePersona";

export type { PersonaType } from "@/lib/personas/personaConfig";

/**
 * Max homes in the multi-select / Compare basket. Compare renders one column
 * (table) or one labelled dot (value plot) per home; 8 keeps the table legible
 * and the plot readable, and matches the ~7±2 a person can weigh at once.
 * Mirrored by MAX_COLUMNS in app/(app)/properties/compare/page.tsx — keep in sync.
 */
export const MAX_SELECTED = 8;

export type CommuteMode = "driving" | "walking" | "cycling";

/**
 * Instrument Deck — which rail module's drawer is open (null = none). Only one
 * drawer is open at a time so the map is never buried under stacked panels.
 */
export type RailModule = "commute" | "school" | "amenity" | "color" | "draw" | "compare" | "time" | "lenses";

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
  /** Draw real attendance-boundary polygons on the map (overlay; independent of the
   *  score filter). Drives useSchoolCatchmentLayers for the current level/system. */
  showZones: boolean;
}

const defaultSchool: SchoolState = {
  enabled: false,
  level: "elementary",
  system: "public",
  minScore: 0,
  targetSchool: null,
  showZones: false,
};

export type AmenityKind = "grocery" | "recreation" | "either";

/**
 * Walkability filter (global, applies across personas). Narrows the list + map to
 * homes within `maxKm` straight-line of a grocery store and/or a recreation centre,
 * via the precomputed NearestGroceryKm / NearestRecCentreKm Typesense fields.
 */
export interface AmenityState {
  enabled: boolean;
  kind: AmenityKind;
  maxKm: number; // straight-line distance ceiling
}

const defaultAmenity: AmenityState = {
  enabled: false,
  kind: "grocery",
  maxKm: 1,
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
  setFilters: (filters: TerminalFilterState) => void;
  resetFilters: () => void;

  // Universal composable filters (price/beds/baths/type) — persona-independent.
  universalFilters: UniversalFilterState;
  setUniversalFilter: (key: string, value: FilterValue) => void;
  resetUniversalFilters: () => void;

  // Fundamental axes — the two hard segmentations that sit BEFORE the persona /
  // composable filters and gate the whole query (sale vs rent, residential vs
  // commercial). The persona/investor analytics layer is residential-sale only.
  transactionMode: TransactionMode;
  setTransactionMode: (mode: TransactionMode) => void;
  // Active layers — multi-select For Sale·Sold·Leased·For Rent (any combination,
  // never empty). transactionMode/price bounds follow transactionModeForLayers().
  activeLayers: Set<LayerKey>;
  toggleLayer: (key: LayerKey) => void;

  // Sold-comp window (days) + the anonymous gate flag for the teaser overlay.
  soldWindowDays: number;
  setSoldWindowDays: (days: number) => void;
  soldLocked: boolean;
  setSoldLocked: (locked: boolean) => void;
  /** Total comps found by the last sold/comps fetch — drives the comps-anchor chip. */
  soldCount: number;
  setSoldCount: (n: number) => void;
  propertyClass: PropertyClass;
  setPropertyClass: (cls: PropertyClass) => void;

  // Which non-pinned filters the user has added to the bar (chip shown even at default).
  addedFilterKeys: string[];
  addFilter: (key: string) => void;
  removeAddedFilter: (key: string) => void;
  clearAddedFilters: () => void;

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
  // True when the last add was blocked by MAX_SELECTED, so the basket can
  // explain the cap. Cleared on any successful add / remove / clear.
  selectionLimitHit: boolean;

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

  // Walkability filter — nearest grocery / recreation centre (global)
  amenity: AmenityState;
  setAmenity: (patch: Partial<AmenityState>) => void;
  resetAmenity: () => void;

  // Total found (full count, independent of the ≤100 render cap)
  totalCount: number;
  setTotalCount: (count: number) => void;

  // Current map viewport (null = whole-zone, no bounding-box constraint)
  mapBounds: MapBounds | null;
  setMapBounds: (bounds: MapBounds | null) => void;
  /** Bumped by "Search this map area": clears the place filter and signals the map to
   *  commit its CURRENT viewport as the search box, so results scope to what's on screen
   *  (ignoring any typed place) instead of broadening to everything. */
  searchAreaNonce: number;
  searchVisibleArea: () => void;

  // Search V2: imperative map fly-to. The search bar sets a target; AlphaMap
  // consumes it (the `nonce` bumps so re-selecting the same place re-flies).
  flyTo: { lat: number; lng: number; zoom?: number; nonce: number } | null;
  setFlyTo: (target: { lat: number; lng: number; zoom?: number } | null) => void;
  // A pin dropped at a searched/geocoded address that has no active listing.
  /** A dropped map pin. For comps-on-demand it also carries the subject's constraints
   *  (type keys + ±band price) so the sold-comp fetch returns SIMILAR solds, not all. */
  searchPin: {
    lat: number;
    lng: number;
    label?: string;
    comps?: boolean;
    types?: string[];
    minPrice?: number;
    maxPrice?: number;
  } | null;
  setSearchPin: (
    pin: {
      lat: number;
      lng: number;
      label?: string;
      comps?: boolean;
      types?: string[];
      minPrice?: number;
      maxPrice?: number;
    } | null
  ) => void;
  /** Enter comps-on-demand for one address: focus the view on SOLD only (so the count,
   *  list, and pins all show the SAME similar comps — not For Sale stacked on top) and
   *  carry the subject's type + price band on the pin to constrain the fetch. */
  enterComps: (pin: {
    lat: number;
    lng: number;
    label?: string;
    types?: string[];
    minPrice?: number;
    maxPrice?: number;
  }) => void;
  /** Leave comps mode: drop the pin and, only if we were in comps, restore For Sale. */
  exitComps: () => void;

  // Map render mode (Instrument Deck mode dock). Lifted out of AlphaMap so the
  // rail/dock can drive it. Reset to the persona default on persona change.
  mapMode: MapMode;
  setMapMode: (mode: MapMode) => void;

  // Zoning overlay lens (municipal open data; independent of persona/mapMode).
  showZoning: boolean;
  setShowZoning: (v: boolean) => void;

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
  /** Direct setter used when rehydrating a saved market bubble (skips the click loop). */
  setDrawPolygon: (polygon: [number, number][] | null) => void;

  // Temporal scrubber: a True-DOM time window swept over the loaded listings
  // (Temporal Distress Engine, made visual — client-side, no re-query).
  timelineActive: boolean;
  setTimelineActive: (on: boolean) => void;
  domCenter: number; // center day of the visible DOM window
  setDomCenter: (day: number) => void;
  timelinePlaying: boolean;
  setTimelinePlaying: (on: boolean) => void;

  // ⌘K command palette
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
}

export const useCommandCenterStore = create<CommandCenterState>((set) => ({
  activePersona: SCOPE_DEFAULT_PERSONA.terminal,
  setActivePersona: (persona) => set({ activePersona: persona }),

  filters: { ...defaultTerminalFilters },
  setFilter: (key, value) =>
    set((state) => ({ filters: { ...state.filters, [key]: value } })),
  setFilters: (filters) => set({ filters: { ...filters } }),
  resetFilters: () =>
    set({
      filters: { ...defaultTerminalFilters },
      commute: { ...defaultCommute },
      school: { ...defaultSchool },
      amenity: { ...defaultAmenity },
    }),

  universalFilters: makeDefaultUniversalFilters(),
  setUniversalFilter: (key, value) =>
    set((state) => ({ universalFilters: { ...state.universalFilters, [key]: value } })),
  resetUniversalFilters: () => set({ universalFilters: makeDefaultUniversalFilters() }),

  transactionMode: "sale",
  // Switching sale↔rent resets the price range — sale ($0–3M) and rent ($0–12k)
  // use different bounds, so a carried-over value would sit off the new slider.
  setTransactionMode: (mode) =>
    set((state) => {
      const { min, max } = priceConfig(mode);
      return { transactionMode: mode, universalFilters: { ...state.universalFilters, price: [min, max] } };
    }),
  activeLayers: new Set<LayerKey>(["forSale"]),
  toggleLayer: (key) =>
    set((state) => {
      const next = applyLayerToggle(state.activeLayers, key);
      const tx = transactionModeForLayers(next);
      const { min, max } = priceConfig(tx);
      return {
        activeLayers: next,
        transactionMode: tx,
        universalFilters: { ...state.universalFilters, price: [min, max] },
        // Manually touching the layer tabs takes you OUT of comps-on-demand: drop the
        // anchor + constraint so the layers behave normally again (a discoverable exit).
        ...(state.searchPin?.comps ? { searchPin: null, soldCount: 0 } : {}),
      };
    }),

  soldWindowDays: SOLD_DISPLAY_MAX_DAYS,
  setSoldWindowDays: (days) => set({ soldWindowDays: days }),
  soldLocked: false,
  setSoldLocked: (locked) => set({ soldLocked: locked }),
  soldCount: 0,
  setSoldCount: (n) => set({ soldCount: n }),
  propertyClass: "residential",
  // Switching class clears the Property Type picker — residential & commercial use
  // different PropertySubType spellings, so a stale selection would zero out results.
  setPropertyClass: (cls) =>
    set((state) => ({
      propertyClass: cls,
      universalFilters: { ...state.universalFilters, homeType: [] },
    })),

  addedFilterKeys: [],
  addFilter: (key) =>
    set((state) =>
      state.addedFilterKeys.includes(key)
        ? {}
        : { addedFilterKeys: [...state.addedFilterKeys, key] }
    ),
  removeAddedFilter: (key) =>
    set((state) => ({ addedFilterKeys: state.addedFilterKeys.filter((k) => k !== key) })),
  clearAddedFilters: () => set({ addedFilterKeys: [] }),

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
      if (next.has(id)) {
        next.delete(id);
        // Leaving zero selected exits the isolated view AND tap-to-add so the user isn't
        // stranded in select mode with an empty basket (they can re-enable from the drawer).
        const emptied = next.size === 0;
        return {
          selectedIds: next,
          selectionLimitHit: false,
          showSelectedOnly: emptied ? false : state.showSelectedOnly,
          isSelectMode: emptied ? false : state.isSelectMode,
        };
      }
      // Cap the basket at MAX_SELECTED: block the add and flag it so the UI can
      // tell the user to remove one before adding another.
      if (next.size >= MAX_SELECTED) {
        return { selectionLimitHit: true };
      }
      next.add(id);
      return { selectedIds: next, selectionLimitHit: false };
    }),
  clearSelected: () =>
    set({ selectedIds: new Set<string>(), showSelectedOnly: false, selectionLimitHit: false, isSelectMode: false }),
  isSelectMode: false,
  setSelectMode: (on) => set({ isSelectMode: on }),
  showSelectedOnly: false,
  setShowSelectedOnly: (on) => set({ showSelectedOnly: on }),
  selectionLimitHit: false,

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

  amenity: { ...defaultAmenity },
  setAmenity: (patch) =>
    set((state) => ({ amenity: { ...state.amenity, ...patch } })),
  resetAmenity: () => set({ amenity: { ...defaultAmenity } }),

  totalCount: 0,
  setTotalCount: (count) => set({ totalCount: count }),

  mapBounds: null,
  setMapBounds: (bounds) => set({ mapBounds: bounds }),
  searchAreaNonce: 0,
  searchVisibleArea: () => set((s) => ({ location: "", searchAreaNonce: s.searchAreaNonce + 1 })),

  flyTo: null,
  setFlyTo: (target) =>
    set((state) => ({
      flyTo: target ? { ...target, nonce: (state.flyTo?.nonce ?? 0) + 1 } : null,
    })),
  searchPin: null,
  setSearchPin: (pin) => set({ searchPin: pin }),
  enterComps: (pin) =>
    set((state) => {
      // Sold-only: queryPlan then fetches just the (constrained) comps, so totalCount =
      // the comp count = the chip count = the pins. No For Sale stacked on top.
      const next = new Set<LayerKey>(["sold"]);
      const tx = transactionModeForLayers(next);
      const { min, max } = priceConfig(tx);
      return {
        searchPin: { ...pin, comps: true },
        activeLayers: next,
        transactionMode: tx,
        universalFilters: { ...state.universalFilters, price: [min, max] },
      };
    }),
  exitComps: () =>
    set((state) => {
      if (!state.searchPin?.comps) return { searchPin: null }; // plain pin → just drop it
      const next = new Set<LayerKey>(["forSale"]);
      const tx = transactionModeForLayers(next);
      const { min, max } = priceConfig(tx);
      return {
        searchPin: null,
        soldCount: 0,
        activeLayers: next,
        transactionMode: tx,
        universalFilters: { ...state.universalFilters, price: [min, max] },
      };
    }),

  mapMode: "listings",
  setMapMode: (mode) => set({ mapMode: mode }),

  showZoning: false,
  setShowZoning: (v) => set({ showZoning: v }),

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
  setDrawPolygon: (polygon) => set({ isDrawing: false, drawPoints: [], drawPolygon: polygon }),

  timelineActive: false,
  setTimelineActive: (on) => set({ timelineActive: on, timelinePlaying: on ? false : false }),
  domCenter: 45,
  setDomCenter: (day) => set({ domCenter: day }),
  timelinePlaying: false,
  setTimelinePlaying: (on) => set({ timelinePlaying: on }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
}));
