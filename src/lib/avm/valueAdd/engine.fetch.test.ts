// src/lib/avm/valueAdd/engine.fetch.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchValueAddReport } from './engine';
import * as anchorService from '../anchorService';
import * as auditService from '../auditService';
import * as matrixService from '../matrixService';
import { BRAMPTON_WEST_DETACHED, subject } from './__fixtures__/cohorts';

describe('fetchValueAddReport', () => {
  it('assembles market data via the AVM services and returns a report', async () => {
    vi.spyOn(matrixService, 'fetchCoefficients').mockResolvedValue(BRAMPTON_WEST_DETACHED.coefficients);
    vi.spyOn(auditService, 'fetchAuditInfo').mockResolvedValue({
      r2: BRAMPTON_WEST_DETACHED.r2, basePrice: BRAMPTON_WEST_DETACHED.basePrice, n: BRAMPTON_WEST_DETACHED.n!,
    });
    vi.spyOn(anchorService, 'fetchAnchor').mockResolvedValue(BRAMPTON_WEST_DETACHED.anchor);

    const input = subject({
      cityRegion: 'Brampton West',
      buildingAreaTotal: 1560, bathroomsTotalInteger: 3, bedroomsAboveGrade: 3,
      parkingTotal: 2, basementTier: 5, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
    });
    const report = await fetchValueAddReport({} as any, input);
    expect(report.subjectEstimate).toBeGreaterThan(0);
    expect(report.moves.length).toBe(9);
    expect(report.headlineUpside).toBeGreaterThan(0);
  });
});
