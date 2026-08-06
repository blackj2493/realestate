// src/lib/reno/cohort.ts
//
// Shape of the beds × type grids the renovation result renders — the SAME "what homes
// sell / rent for here" tables as the listing and address pages, fetched by
// /api/reno/cohort and handed straight to <MarketGrids>.
//
// Deliberately types-only: the tool shows the WHOLE grid rather than reducing it to one
// cell. Picking a single "homes like yours" median needed a bedroom count we don't have
// (the engine models a typical 3-bed unless the owner adds their details), so the pickers
// that used to live here were removed along with the numbers they fed.

import type { AskingMatrix } from '@/lib/address/nearbyForSale';

/** The full beds × type grid for one side of the market, as MarketGrids consumes it. */
export interface CohortGrid<S extends string> {
  matrix: AskingMatrix;
  radiusKm: number;
  source: S;
}

export interface RenoCohort {
  /** Sale side: actual closes (consumer) or live asking prices (anon) — always labelled. */
  sell: CohortGrid<'sold' | 'asking'> | null;
  /** Rent side: achieved leases (consumer) or asking rents (anon). */
  rent: CohortGrid<'leased' | 'asking'> | null;
}
