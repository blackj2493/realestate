/**
 * Command Center Zustand Store
 * Manages state for the Smart Homebuyer 100vh Command Center interface
 */

import { create } from 'zustand';
import type { ListingDocument, SearchResult } from '@/lib/typesense/client';

// ============================================================================
// Types
// ============================================================================

export type PersonaType = 
  | 'cashflow'      // Cashflow Investor
  | 'builders'      // Builders & Developers
  | 'flippers'      // Flippers & Deal Hunters
  | 'smart'         // Smart Homebuyer (active for this UI)

export type CapExRisk = 'move-in-ready' | 'light-tlc' | 'major-work';

// Smart Homebuyer specific filters
export interface SmartHomebuyerFilters {
  maxCarryCost: number;          // Max monthly carry cost ($0-$10,000)
  trueDOMMin: number;            // Min True Days on Market (0-365)
  trueDOMMax: number;            // Max True Days on Market (0-365)
  suiteFilter: 'ALL' | 'NONE' | 'POTENTIAL_CANDIDATE' | 'EXISTING_SUITE'; // Suite status filter
  minSuiteScore: number;         // Minimum suite score (0-6)
  mortgageHelperEnabled: boolean; // KitchensBelowGrade > 0 OR basement suite potential
  capExRisk: CapExRisk;          // Move-In Ready / Light TLC / Major Work
  biddingWarExclude: boolean;    // Exclude properties with holding offers
}

// Legacy filter types for other personas (kept for compatibility)
export interface LegacyFilters {
  minPrice: number;
  maxPrice: number;
  minYield: number;
  minBedrooms: number;
  maxDOM: number;
  hasSuitePotential: boolean;
  isDistressed: boolean;
  minLotWidth: number;
  minLotDepth: number;
}

export interface CommandCenterState {
  // Persona
  activePersona: PersonaType;
  setActivePersona: (persona: PersonaType) => void;

  // Smart Homebuyer Filters
  smartFilters: SmartHomebuyerFilters;
  setSmartFilters: (filters: SmartHomebuyerFilters) => void;
  updateSmartFilter: <K extends keyof SmartHomebuyerFilters>(
    key: K, 
    value: SmartHomebuyerFilters[K]
  ) => void;

  // Legacy Filters (for other personas)
  legacyFilters: LegacyFilters;
  setLegacyFilters: (filters: LegacyFilters) => void;

  // Selected Property for Terminal
  selectedProperty: ListingDocument | null;
  setSelectedProperty: (property: ListingDocument | null) => void;
  isTerminalOpen: boolean;
  setIsTerminalOpen: (open: boolean) => void;

  // Search Results
  searchResult: SearchResult | null;
  setSearchResult: (result: SearchResult | null) => void;

  // UI State
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;

  // Location
  location: string;
  setLocation: (location: string) => void;

  // Pagination
  totalCount: number;
  setTotalCount: (count: number) => void;
}

// ============================================================================
// Default Filter Values
// ============================================================================

const defaultSmartFilters: SmartHomebuyerFilters = {
  maxCarryCost: 10000,
  trueDOMMin: 0,
  trueDOMMax: 365,
  suiteFilter: 'ALL',
  minSuiteScore: 0,
  mortgageHelperEnabled: false,
  capExRisk: 'move-in-ready',
  biddingWarExclude: false,
};

const defaultLegacyFilters: LegacyFilters = {
  minPrice: 0,
  maxPrice: 5000000,
  minYield: 0,
  minBedrooms: 0,
  maxDOM: 365,
  hasSuitePotential: false,
  isDistressed: false,
  minLotWidth: 0,
  minLotDepth: 0,
};

// ============================================================================
// Store
// ============================================================================

export const useCommandCenterStore = create<CommandCenterState>((set) => ({
  // Persona - default to Smart Homebuyer
  activePersona: 'smart',
  setActivePersona: (persona) => set({ activePersona: persona }),

  // Smart Homebuyer Filters
  smartFilters: defaultSmartFilters,
  setSmartFilters: (filters) => set({ smartFilters: filters }),
  updateSmartFilter: (key, value) =>
    set((state) => ({
      smartFilters: { ...state.smartFilters, [key]: value },
    })),

  // Legacy Filters
  legacyFilters: defaultLegacyFilters,
  setLegacyFilters: (filters) => set({ legacyFilters: filters }),

  // Selected Property
  selectedProperty: null,
  setSelectedProperty: (property) => set({ 
    selectedProperty: property,
    isTerminalOpen: property !== null,
  }),
  isTerminalOpen: false,
  setIsTerminalOpen: (open) => set({ 
    isTerminalOpen: open,
    selectedProperty: open ? undefined : null,
  }),

  // Search Results
  searchResult: null,
  setSearchResult: (result) => set({ searchResult: result }),

  // UI State
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  error: null,
  setError: (error) => set({ error: error }),

  // Location
  location: '',
  setLocation: (location) => set({ location }),

  // Pagination
  totalCount: 0,
  setTotalCount: (count) => set({ totalCount: count }),
}));

// ============================================================================
// Selectors
// ============================================================================

/**
 * Get filter string for Smart Homebuyer persona
 * Maps UI controls to Typesense search parameters
 */
export function getSmartHomebuyerFilterString(filters: SmartHomebuyerFilters): string {
  const parts: string[] = [];

  // Max True Carry Cost - direct filter on MonthlyCarryCost field
  if (filters.maxCarryCost < 10000) {
    parts.push(`MonthlyCarryCost:<=${filters.maxCarryCost}`);
  }

  // True DOM Range
  if (filters.trueDOMMin > 0) {
    parts.push(`TrueDom:>=${filters.trueDOMMin}`);
  }
  if (filters.trueDOMMax < 365) {
    parts.push(`TrueDom:<=${filters.trueDOMMax}`);
  }

  // Suite Status Filter
  if (filters.suiteFilter !== 'ALL') {
    if (filters.suiteFilter === 'NONE') {
      parts.push(`SuiteStatus:=NONE`);
    } else if (filters.suiteFilter === 'POTENTIAL_CANDIDATE') {
      parts.push(`(SuiteStatus:=POTENTIAL_CANDIDATE || SuiteStatus:=EXISTING_SUITE)`);
    } else if (filters.suiteFilter === 'EXISTING_SUITE') {
      parts.push(`SuiteStatus:=EXISTING_SUITE`);
    }
  }

  // Suite Score Minimum
  if (filters.minSuiteScore > 0) {
    parts.push(`SuiteScore:>=${filters.minSuiteScore}`);
  }

  // CapEx Risk - filter by ApproximateAge or text matching
  switch (filters.capExRisk) {
    case 'move-in-ready':
      // Filter for newer properties or exclude TLC terms
      parts.push(`ApproximateAge:<=10`);
      break;
    case 'light-tlc':
      parts.push(`ApproximateAge:>=10`);
      parts.push(`ApproximateAge:<=30`);
      break;
    case 'major-work':
      // Properties 30+ years old that may need work
      parts.push(`ApproximateAge:>=30`);
      break;
  }

  return parts.join(' && ');
}

/**
 * Get filter string for Mortgage Helper toggle
 */
export function getMortgageHelperFilterString(enabled: boolean): string {
  if (!enabled) return '';
  // Filter for KitchensBelowGrade > 0 OR basement suite potential
  // These fields need to be added to Typesense schema
  // For now, we'll use a placeholder
  return '(KitchensBelowGrade:>=1 || hasUnfinishedBasement:=true)';
}

/**
 * Get filter string for Bidding War Excluder
 * Excludes regex patterns: "offers reviewed on", "holding offers", "presentation date"
 * Typesense doesn't support regex in filter_by, so we need to handle this in query
 * We can use exclude_fields concept but Typesense doesn't have it
 * Instead, we'll boost properties without these terms
 */
export function getBiddingWarExcludeQuery(): string {
  return '-("offers reviewed on" OR "holding offers" OR "presentation date")';
}