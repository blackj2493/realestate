// src/lib/avm/valueAdd/engine.fetch.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchValueAddReport } from './engine';
import * as anchorService from '../anchorService';
import * as auditService from '../auditService';
import * as matrixService from '../matrixService';
import { MOVE_CATALOG } from './moveCatalog';
import { BRAMPTON_WEST_DETACHED, subject } from './__fixtures__/cohorts';
import type { SupabaseClient } from '@supabase/supabase-js';

// The Supabase client is never touched here (all AVM services are mocked), so a
// bare stub cast to the param type keeps the test honest without an `any`.
const stubClient = {} as unknown as SupabaseClient;

describe('fetchValueAddReport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('assembles market data via the AVM services and returns a report', async () => {
    vi.spyOn(matrixService, 'fetchCoefficients').mockResolvedValue({
      rows: BRAMPTON_WEST_DETACHED.coefficients,
      rung: 'community',
    });
    vi.spyOn(auditService, 'fetchAuditInfo').mockResolvedValue({
      r2: BRAMPTON_WEST_DETACHED.r2, basePrice: BRAMPTON_WEST_DETACHED.basePrice, n: BRAMPTON_WEST_DETACHED.n ?? 117,
    });
    vi.spyOn(anchorService, 'fetchAnchor').mockResolvedValue(BRAMPTON_WEST_DETACHED.anchor);

    const input = subject({
      cityRegion: 'Brampton West',
      buildingAreaTotal: 1560, bathroomsTotalInteger: 3, bedroomsAboveGrade: 3,
      parkingTotal: 2, basementTier: 5, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
    });
    const report = await fetchValueAddReport(stubClient, input);
    expect(report.subjectEstimate).toBeGreaterThan(0);
    expect(report.moves.length).toBe(MOVE_CATALOG.length);
    expect(report.headlineUpside).toBeGreaterThan(0);
  });

  it('skips the anchor/comps query when predSD is supplied, and still prices moves', async () => {
    vi.spyOn(matrixService, 'fetchCoefficients').mockResolvedValue({
      rows: BRAMPTON_WEST_DETACHED.coefficients,
      rung: 'community',
    });
    vi.spyOn(auditService, 'fetchAuditInfo').mockResolvedValue({
      r2: BRAMPTON_WEST_DETACHED.r2, basePrice: BRAMPTON_WEST_DETACHED.basePrice, n: BRAMPTON_WEST_DETACHED.n ?? 117,
    });
    const anchorSpy = vi.spyOn(anchorService, 'fetchAnchor');

    const input = subject({
      cityRegion: 'Brampton West',
      buildingAreaTotal: 1560, bathroomsTotalInteger: 3, bedroomsAboveGrade: 3,
      parkingTotal: 2, basementTier: 5, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
    });
    const report = await fetchValueAddReport(stubClient, input, {
      subjectEstimate: 861351, predSD: 0.07,
    });

    expect(anchorSpy).not.toHaveBeenCalled();
    expect(report.subjectEstimate).toBe(861351);
    expect(report.moves.some((m) => m.status === 'priced')).toBe(true);
  });
});
