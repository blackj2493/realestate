/**
 * fetchCohortCoefficients / fetchCohortAudit: one round trip, every rung labelled, the
 * rung re-applied in memory. The case that matters is the name collision — 67 city
 * names are also a community spelling — so "Ajax" the community and "Ajax" the city
 * must come back as two cohorts, never one merged feature set.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCoefficients, fetchCohortCoefficients } from './matrixService';
import { fetchAuditInfo, fetchCohortAudit } from './auditService';
import { cohortRungLookupKeys } from './normalizeType';

/**
 * Chainable Supabase stub: every builder method returns the chain; awaiting it resolves
 * to `rows`. The filters are recorded so a test can assert what reached PostgREST.
 */
function makeStub(rows: Record<string, unknown>[]) {
  const filters: Array<[string, unknown, unknown]> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'ilike', 'limit', 'order']) {
    chain[m] = vi.fn((...args: unknown[]) => {
      filters.push([m, args[0], args[1]]);
      return chain;
    });
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: rows, error: null }));
  const from = vi.fn(() => chain);
  return { stub: { from } as unknown as SupabaseClient, filters };
}

const matrixRow = (cohort_rung: string, city_region: string, feature_name: string, beta: number) => ({
  cohort_rung,
  city_region,
  feature_name,
  beta,
  feat_mean: 3,
  feat_std: 1,
});

describe('fetchCohortCoefficients', () => {
  it('keeps "Ajax" the community and "Ajax" the city apart, finest first', async () => {
    const { stub, filters } = makeStub([
      matrixRow('city', 'Ajax', 'bathrooms_total_integer', 0.9),
      matrixRow('community', 'Ajax', 'bathrooms_total_integer', 0.1),
      matrixRow('community', 'Ajax', 'lot_width', 0.2),
      matrixRow('fsa', 'L1S', 'bathrooms_total_integer', 0.5),
    ]);
    const found = await fetchCohortCoefficients(stub, cohortRungLookupKeys('Ajax', 'L1S 2K3', 'Ajax'), 'Detached');

    expect(found.map((f) => f.rung)).toEqual(['community', 'fsa', 'city']);
    expect(found[0].rows.map((r) => r.beta).sort()).toEqual([0.1, 0.2]); // the city's 0.9 never merges in
    expect(found[1].rows).toEqual([{ featureName: 'bathrooms_total_integer', beta: 0.5, mean: 3, std: 1 }]);
    expect(found[2].rows.map((r) => r.beta)).toEqual([0.9]);
    // One query, both rungs and both spellings in the filter.
    expect(filters.find((f) => f[0] === 'in' && f[1] === 'cohort_rung')?.[2]).toEqual(['community', 'fsa', 'city']);
    expect(filters.find((f) => f[0] === 'in' && f[1] === 'city_region')?.[2]).toEqual(['Ajax', 'L1S']);
  });

  it('within a rung keeps only the highest-priority spelling', async () => {
    const { stub } = makeStub([
      matrixRow('community', 'Bronte', 'lot_width', 0.3),
      matrixRow('community', '1001 - BR Bronte', 'lot_width', 0.7),
    ]);
    const found = await fetchCohortCoefficients(stub, cohortRungLookupKeys('1001 - BR Bronte', null, null), 'Detached');
    expect(found).toHaveLength(1);
    expect(found[0].rows.map((r) => r.beta)).toEqual([0.7]); // verbatim wins over stripped
  });

  it('returns nothing for an empty ladder without touching the client', async () => {
    const { stub } = makeStub([]);
    expect(await fetchCohortCoefficients(stub, [], 'Detached')).toEqual([]);
    expect((stub as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });

  it('fetchCoefficients is the community rung alone', async () => {
    const { stub, filters } = makeStub([
      matrixRow('community', 'Ajax', 'lot_width', 0.2),
      matrixRow('city', 'Ajax', 'lot_width', 0.9), // would be returned by a rung-blind query
    ]);
    const rows = await fetchCoefficients(stub, 'Ajax', 'Detached');
    expect(rows.map((r) => r.beta)).toEqual([0.2]);
    expect(filters.find((f) => f[0] === 'in' && f[1] === 'cohort_rung')?.[2]).toEqual(['community']);
  });
});

const auditRow = (cohort_rung: string, city_region: string, r2: number, base: number, n: number) => ({
  cohort_rung,
  city_region,
  model_accuracy_score: r2,
  base_price: base,
  total_sales_analyzed: n,
});

describe('fetchCohortAudit', () => {
  it('labels every rung and keeps the collision apart', async () => {
    const { stub } = makeStub([
      auditRow('city', 'Aylmer', 0.55, 500_000, 400),
      auditRow('community', 'Aylmer', 0.3, 450_000, 20),
    ]);
    const found = await fetchCohortAudit(stub, cohortRungLookupKeys('Aylmer', null, 'Aylmer'), 'Detached');
    expect(found).toEqual([
      { rung: 'community', r2: 0.3, basePrice: 450_000, n: 20 },
      { rung: 'city', r2: 0.55, basePrice: 500_000, n: 400 },
    ]);
  });

  it('omits a rung with no row rather than inventing one', async () => {
    const { stub } = makeStub([auditRow('city', 'Kitchener', 0.49, 805_930, 2122)]);
    const found = await fetchCohortAudit(stub, cohortRungLookupKeys('', 'N2N 3P4', 'Kitchener'), 'Detached');
    expect(found.map((f) => f.rung)).toEqual(['city']);
  });

  it('fetchAuditInfo is the community rung alone and keeps its shape', async () => {
    const { stub } = makeStub([auditRow('community', 'Brampton West', 0.67, 834_143, 153)]);
    expect(await fetchAuditInfo(stub, 'Brampton West', 'Detached')).toEqual({ r2: 0.67, basePrice: 834_143, n: 153 });
    const miss = makeStub([]);
    expect(await fetchAuditInfo(miss.stub, 'Nowhere', 'Detached')).toEqual({ r2: null, basePrice: null, n: null });
  });
});
