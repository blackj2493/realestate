import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));
vi.mock('@/lib/proptx/client', () => ({
  ProptXClient: vi.fn(),
}));
vi.mock('../../../../scripts/worker/sync', () => ({
  processBatch: vi.fn(),
}));
import { getServiceRoleClient } from '@/lib/supabase/client';
import { ProptXClient } from '@/lib/proptx/client';
import { processBatch } from '../../../../scripts/worker/sync';
import * as routeModule from './route';

const mockedProcessBatch = vi.mocked(processBatch);

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
  mockedProcessBatch.mockResolvedValue({
    success: true,
    supabase: { inserted: 1, failed: 0, errors: [] },
    typesense: { indexed: 1, failed: 0, errors: [] },
  } as Awaited<ReturnType<typeof processBatch>>);
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
    const json = (await res.json()) as { success: boolean; listingKey: string; pipeline?: string };
    expect(json.success).toBe(true);
    expect(json.listingKey).toBe('W12632618');
    expect(json.pipeline).toBe('full');
    expect(MockedProptX).toHaveBeenCalledTimes(1);
    expect(mockedProcessBatch).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/sync — removed (unauth full-ETL trigger, audit CRITICAL-6)', () => {
  it('no longer exports a GET handler', () => {
    expect((routeModule as Record<string, unknown>).GET).toBeUndefined();
  });
});

describe('POST /api/sync — full pipeline quick-sync (audit HIGH-6)', () => {
  it('runs processBatch with the fetched listing + attached media', async () => {
    const res = await post({ action: 'quick-sync', listingKey: 'W12632618' });
    expect(res.status).toBe(200);
    expect(mockedProcessBatch).toHaveBeenCalledTimes(1);
    const batch = mockedProcessBatch.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(1);
    expect(batch[0].ListingKey).toBe('W12632618');
    expect(Array.isArray(batch[0].media)).toBe(true); // media attached for transformListing
  });

  it('falls back to the minimal upsert (still 200) when the full pipeline throws', async () => {
    mockedProcessBatch.mockRejectedValueOnce(new Error('TYPESENSE_ADMIN_API_KEY is not set in environment'));
    const upsertSpy = vi.fn().mockResolvedValue({ error: null });
    mockedSupabase.mockReturnValue({ from: vi.fn(() => ({ upsert: upsertSpy })) } as never);
    const res = await post({ action: 'quick-sync', listingKey: 'W12632618' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; pipeline?: string };
    expect(json.success).toBe(true);
    expect(json.pipeline).toBe('fallback-minimal');
    expect(upsertSpy).toHaveBeenCalledTimes(1); // the legacy minimal upsert actually ran
  });

  it('reports the pipeline mode on the happy path', async () => {
    const res = await post({ action: 'quick-sync', listingKey: 'W12632618' });
    expect(((await res.json()) as { pipeline?: string }).pipeline).toBe('full');
  });

  it('reports full-no-typesense when Supabase succeeds but the Typesense write fails', async () => {
    mockedProcessBatch.mockResolvedValueOnce({
      success: false,
      supabase: { inserted: 1, failed: 0, errors: [] },
      typesense: { indexed: 0, failed: 1, errors: ['x'] },
    } as Awaited<ReturnType<typeof processBatch>>);
    const res = await post({ action: 'quick-sync', listingKey: 'W12632618' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { pipeline?: string }).pipeline).toBe('full-no-typesense');
  });
});
