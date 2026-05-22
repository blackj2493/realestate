import { create } from 'zustand';

interface FilterState {
  // Financial Range Filters
  capRateFloor: number;         // min cap rate %
  cashflowFloor: number;        // min cashflow $/mo
  targetYieldMin: number;       // min gross yield %
  
  // Multi-Unit / Suite Filter
  suiteFilters: string[];       // ['PRIME_CANDIDATE', 'EXISTING_MULTI_UNIT', 'MARGINAL_CANDIDATE']
  
  // Property Type
  propertyTypeFilter: string;    // 'All' | 'Freehold' | 'Condo'
  
  // Occupancy
  occupancyFilter: string[];    // ['Vacant', 'Tenanted']
  
  // Parking
  minParkingFilter: number;     // min surplus_parking_count
  
  // Tax Burden (max — lower is better)
  taxBurdenMax: number;         // max tax_burden_ratio %
  
  // Sort
  sortBy: string;               // 'cap_rate_floor' | 'net_monthly_cashflow' | 'gross_yield_est' | 'TrueDOM'
  
  // ─── Flipper & Deal Hunter Filters ─────────────────────────────────────
  showOnlyDistressed: boolean; // show only distressed/assignment/fixer properties
  maxHoldingCostRange: [number, number]; // [min, max] monthly holding cost
  minTrueDomRange: [number, number]; // [min, max] true days on market
  unfinishedBasementOnly: boolean; // show only properties with unfinished basement
  vacantPossessionOnly: boolean; // show only vacant possession properties
  priceDropRange: [number, number]; // [min, max] price drop percentage
  
  // ─── Builder Filters ────────────────────────────────────────────────────
  minFrontage: number | null;      // min lot width in feet
  minLotSqft: number | null;       // min lot area in sqft
  devPlaysOnly: boolean;           // show only severance/density candidates
  multiplexByRight: boolean;        // show only multiplex-by-right properties
  coveredLand: boolean;            // show only covered land/tear-down candidates
  
  // Actions
  setCapRateFloor: (v: number) => void;
  setCashflowFloor: (v: number) => void;
  setTargetYieldMin: (v: number) => void;
  toggleSuiteFilter: (v: string) => void;
  setPropertyTypeFilter: (v: string) => void;
  toggleOccupancyFilter: (v: string) => void;
  setMinParkingFilter: (v: number) => void;
  setTaxBurdenMax: (v: number) => void;
  setSortBy: (v: string) => void;
  setShowOnlyDistressed: (v: boolean) => void;
  setMaxHoldingCostRange: (v: [number, number]) => void;
  setMinTrueDomRange: (v: [number, number]) => void;
  setUnfinishedBasementOnly: (v: boolean) => void;
  setVacantPossessionOnly: (v: boolean) => void;
  setPriceDropRange: (v: [number, number]) => void;
  
  // Builder filter actions
  setMinFrontage: (value: number | null) => void;
  setMinLotSqft: (value: number | null) => void;
  setDevPlaysOnly: (value: boolean) => void;
  setMultiplexByRight: (value: boolean) => void;
  setCoveredLand: (value: boolean) => void;
  resetBuilderFilters: () => void;
  
  // Combined filter string getter for Typesense
  getBuilderFilterString: () => string;
  
  // Get full search query with builder filters integrated
  getSearchQuery: () => string;
  
  resetFilters: () => void;
}

const DEFAULT_SUITE_FILTERS = ['PRIME_CANDIDATE', 'EXISTING_MULTI_UNIT'];

const initialState = {
  capRateFloor: 0,
  cashflowFloor: 0,
  targetYieldMin: 0,
  suiteFilters: DEFAULT_SUITE_FILTERS,
  propertyTypeFilter: 'All',
  occupancyFilter: ['Vacant', 'Tenanted'],
  minParkingFilter: 0,
  taxBurdenMax: 100,
  sortBy: 'cap_rate_floor',
  // ─── Flipper & Deal Hunter Filters ─────────────────────────────────────
  showOnlyDistressed: false,
  maxHoldingCostRange: [0, 10000] as [number, number],
  minTrueDomRange: [0, 365] as [number, number],
  unfinishedBasementOnly: false,
  vacantPossessionOnly: false,
  priceDropRange: [0, 100] as [number, number],
  // ─── Builder Filters ────────────────────────────────────────────────────
  minFrontage: null,
  minLotSqft: null,
  devPlaysOnly: false,
  multiplexByRight: false,
  coveredLand: false,
};

export const useFilterStore = create<FilterState>((set, get) => ({
  ...initialState,
  setCapRateFloor: (v) => set({ capRateFloor: v }),
  setCashflowFloor: (v) => set({ cashflowFloor: v }),
  setTargetYieldMin: (v) => set({ targetYieldMin: v }),
  toggleSuiteFilter: (v) => set((state) => {
    const exists = state.suiteFilters.includes(v);
    if (exists && state.suiteFilters.length === 1) return state; // keep at least one
    return {
      suiteFilters: exists
        ? state.suiteFilters.filter((f) => f !== v)
        : [...state.suiteFilters, v],
    };
  }),
  setPropertyTypeFilter: (v) => set({ propertyTypeFilter: v }),
  toggleOccupancyFilter: (v) => set((state) => {
    const exists = state.occupancyFilter.includes(v);
    if (exists && state.occupancyFilter.length === 1) return state;
    return {
      occupancyFilter: exists
        ? state.occupancyFilter.filter((f) => f !== v)
        : [...state.occupancyFilter, v],
    };
  }),
  setMinParkingFilter: (v) => set({ minParkingFilter: v }),
  setTaxBurdenMax: (v) => set({ taxBurdenMax: v }),
  setSortBy: (v) => set({ sortBy: v }),
  setShowOnlyDistressed: (v) => set({ showOnlyDistressed: v }),
  setMaxHoldingCostRange: (v) => set({ maxHoldingCostRange: v }),
  setMinTrueDomRange: (v) => set({ minTrueDomRange: v }),
  setUnfinishedBasementOnly: (v) => set({ unfinishedBasementOnly: v }),
  setVacantPossessionOnly: (v) => set({ vacantPossessionOnly: v }),
  setPriceDropRange: (v) => set({ priceDropRange: v }),
  
  // Builder filter actions
  setMinFrontage: (value) => set({ minFrontage: value }),
  setMinLotSqft: (value) => set({ minLotSqft: value }),
  setDevPlaysOnly: (value) => set({ devPlaysOnly: value }),
  setMultiplexByRight: (value) => set({ multiplexByRight: value }),
  setCoveredLand: (value) => set({ coveredLand: value }),
  resetBuilderFilters: () => set({
    minFrontage: null,
    minLotSqft: null,
    devPlaysOnly: false,
    multiplexByRight: false,
    coveredLand: false,
  }),
  
  // Get Typesense-compatible filter string for builder filters
  getBuilderFilterString: () => {
    const state = get();
    const filters: string[] = [];
    
    if (state.minFrontage !== null) {
      filters.push(`lot_width_ft:>=${state.minFrontage}`);
    }
    
    if (state.minLotSqft !== null) {
      filters.push(`lot_area_sqft:>=${state.minLotSqft}`);
    }
    
    if (state.devPlaysOnly) {
      filters.push('severance_candidate:=true');
    }
    
    if (state.devPlaysOnly || state.coveredLand) {
      filters.push('is_covered_land:=true');
    }
    
    if (state.multiplexByRight) {
      filters.push('multiplex_by_right:=true');
    }
    
    return filters.join(' && ');
  },
  
  // Get full search query with all filters integrated
  getSearchQuery: () => {
    const state = get();
    const builderFilters = state.getBuilderFilterString();
    // This method would be used by the search component to build the full query
    // Base filters would come from other state properties
    return builderFilters;
  },
  
  resetFilters: () => set(initialState),
}));