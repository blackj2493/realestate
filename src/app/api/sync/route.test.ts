import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));
vi.mock('@/lib/proptx/client', () => ({
  ProptXClient: vi.fn(),
}));
import { getServiceRoleClient } from '@/lib/supabase/client';
import { ProptXClient } from '@/lib/proptx/client';
import * as routeModule from './route';

const MockedProptX = vi.mocked(ProptXClient);
const mockedSupabase = vi.mocked(getServiceRoleClient);

function post(body: unknown): Promise<Response> {
  return routeModule.POST(
    new NextRequest(new URL('http://x/api/sync'), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PROPTX_VOW_TOKEN = 'test-vow-token';
  MockedProptX.mockImplementation(function () {
    return {
      getProperties: vi.fn().mockResolvedValue({
        value: [{ ListingKey: 'W12632618', City: 'Brampton', PropertySubType: 'Detached', DaysOnMarket: 5 }],
      }),
      getMediaBatch: vi.fn().mockResolvedValue({ value: [] }),
    };
  } as unknown as new (...args: unknown[]) => InstanceType<typeof ProptXClient>);
  mockedSupabase.mockReturnValue({
    from: vi.fn(() => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    })),
  } as unknown as ReturnType<typeof getServiceRoleClient>);
});

describe('POST /api/sync — listingKey validation (OData injection guard)', () => {
  it("rejects an OData injection payload with 400 and never calls ProptX", async () => {
    const res = await post({
      action: 'quick-sync',
      listingKey: "X' or 1 eq 1 or ListingKey eq 'Y",
      priority: 'high',
    });
    expect(res.status).toBe(400);
    expect(MockedProptX).not.toHaveBeenCalled();
  });

  it('rejects a lowercase / malformed key with 400', async () => {
    const res = await post({ action: 'quick-sync', listingKey: 'w12632618; drop' });
    expect(res.status).toBe(400);
    expect(MockedProptX).not.toHaveBeenCalled();
  });

  it('rejects a non-string listingKey with 400', async () => {
    const res = await post({ action: 'quick-sync', listingKey: { $filter: '1 eq 1' } });
    expect(res.status).toBe(400);
    expect(MockedProptX).not.toHaveBeenCalled();
  });

  it('accepts a well-formed TRREB key and syncs it', async () => {
    const res = await post({ action: 'quick-sync', listingKey: 'W12632618', priority: 'high' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; listingKey: string };
    expect(json.success).toBe(true);
    expect(json.listingKey).toBe('W12632618');
    expect(MockedProptX).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/sync — removed (unauth full-ETL trigger, audit CRITICAL-6)', () => {
  it('no longer exports a GET handler', () => {
    expect((routeModule as Record<string, unknown>).GET).toBeUndefined();
  });
});
