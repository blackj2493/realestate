import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(() => ({})),
}));
vi.mock('@/lib/avm/calculator', () => ({
  calculateAVM: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'test-user' }),
}));

import { calculateAVM } from '@/lib/avm/calculator';
import { getCurrentUser } from '@/lib/supabase/server';
import { POST } from './route';

const mockAvm = vi.mocked(calculateAVM);

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://x/api/avm', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

const VALID_BODY = {
  cityRegion: 'Brampton',
  propertySubType: 'Detached',
  bedroomsAboveGrade: 4,
  bathroomsTotalInteger: 3,
  parkingTotal: 2,
  interiorTier: 3,
  exteriorTier: 3,
  basementTier: 3,
};

beforeEach(() => {
  mockAvm.mockReset();
  mockAvm.mockResolvedValue({
    estimatedValue: 1_000_000,
    anchorPrice: 1_000_000,
    totalAdjustmentPct: 0,
    engineMode: 'ANCHOR_ONLY',
    r2Score: null,
    breakdown: {
      buildingAreaAdjustment: 0,
      lotWidthAdjustment: 0,
      bedroomsAdjustment: 0,
      bathroomsAdjustment: 0,
      parkingAdjustment: 0,
      interiorAdjustment: 0,
      exteriorAdjustment: 0,
      basementAdjustment: 0,
    },
    confidence: 'HIGH',
    comps: 10,
    nEff: 5,
    basis: 'local',
    lowBand: 950_000,
    highBand: 1_050_000,
    predictiveSD: 0.05,
  });
});

describe('POST /api/avm — Zod validation', () => {
  it('returns 400 with a details payload when a required field is missing', async () => {
    const { propertySubType, ...partial } = VALID_BODY;
    void propertySubType;
    const res = await post(partial);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid input');
    // Zod flatten shape — surfacing exactly which field failed.
    expect(body.details).toBeDefined();
    expect(mockAvm).not.toHaveBeenCalled();
  });

  it('rejects out-of-range tier values', async () => {
    const res = await post({ ...VALID_BODY, interiorTier: 99 });
    expect(res.status).toBe(400);
  });

  it('rejects bedroomsAboveGrade > 10', async () => {
    const res = await post({ ...VALID_BODY, bedroomsAboveGrade: 50 });
    expect(res.status).toBe(400);
  });

  it('accepts city as null/undefined (optional field)', async () => {
    const res = await post({ ...VALID_BODY, city: null });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/avm — auth gate', () => {
  it('returns 401 (and never runs the AVM) when not signed in', async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(401);
    expect(mockAvm).not.toHaveBeenCalled();
  });
});

describe('POST /api/avm — calculateAVM invocation', () => {
  it('passes the verbatim subtype as rawPropertySubType and the normalized form as propertySubType', async () => {
    await post({ ...VALID_BODY, propertySubType: 'Att/Row/Townhouse' });
    expect(mockAvm).toHaveBeenCalledTimes(1);
    const input = mockAvm.mock.calls[0][1];
    expect(input.rawPropertySubType).toBe('Att/Row/Townhouse');
    expect(input.propertySubType).toBe('Townhouse'); // normalized
  });

  it('sets buildingAreaTotal + lotWidth to null (the manual calculator skips them)', async () => {
    await post(VALID_BODY);
    const input = mockAvm.mock.calls[0][1];
    expect(input.buildingAreaTotal).toBeNull();
    expect(input.lotWidth).toBeNull();
  });

  it('forwards bedrooms/bathrooms/parking + tiers without transformation', async () => {
    await post(VALID_BODY);
    const input = mockAvm.mock.calls[0][1];
    expect(input.bedroomsAboveGrade).toBe(4);
    expect(input.bathroomsTotalInteger).toBe(3);
    expect(input.parkingTotal).toBe(2);
    expect(input.interiorTier).toBe(3);
    expect(input.exteriorTier).toBe(3);
    expect(input.basementTier).toBe(3);
  });

  it('passes through the AVMResult body on success', async () => {
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.estimatedValue).toBe(1_000_000);
    expect(body.confidence).toBe('HIGH');
  });

  it('returns 500 when calculateAVM throws', async () => {
    mockAvm.mockRejectedValueOnce(new Error('supabase down'));
    const res = await post(VALID_BODY);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
  });
});
