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
};

export const useFilterStore = create<FilterState>((set) => ({
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
  resetFilters: () => set(initialState),
}));