/**
 * AVM Store — Zustand state management for AVM calculator
 */

import { create } from 'zustand';
import type { AVMResult } from '@/lib/avm/types';

interface AVMState {
  cityRegion: string;
  propertySubType: string;
  bedroomsAboveGrade: number;
  bathroomsTotalInteger: number;
  parkingTotal: number;
  interiorTier: number;
  exteriorTier: number;
  basementTier: number;
  result: AVMResult | null;
  isLoading: boolean;
  error: string | null;
  setField: (
    field: keyof Omit<
      AVMState,
      'result' | 'isLoading' | 'error' | 'setField' | 'setResult' | 'reset'
    >,
    value: number | string
  ) => void;
  setResult: (result: AVMResult | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  cityRegion: '',
  propertySubType: '',
  bedroomsAboveGrade: 3,
  bathroomsTotalInteger: 2,
  parkingTotal: 1,
  interiorTier: 3,
  exteriorTier: 3,
  basementTier: 5,
  result: null,
  isLoading: false,
  error: null,
};

export const useAVMStore = create<AVMState>((set) => ({
  ...initialState,
  setField: (field, value) => set({ [field]: value }),
  setResult: (result) => set({ result, isLoading: false, error: null }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  reset: () => set(initialState),
}));