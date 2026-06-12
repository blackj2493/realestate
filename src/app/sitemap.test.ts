import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));

import { getServiceRoleClient } from '@/lib/supabase/client';
import sitemap from './sitemap';

/** Chainable stub whose range(from, to) returns a slice of `dataset`,
 *  mimicking PostgREST range pagination (then-only thenable). */
function supabaseReturningSlices(dataset: { listing_key: string; synced_at: string }[]) {
  let from = 0;
  let to = 0;
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'order']) q[m] = vi.fn(() => q);
  q.range = vi.fn((f: number, t: number) => {
    from = f;
    to = t;
    return q;
  });
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolve({ data: dataset.slice(from, to + 1), error: null }));
  return q as unknown as ReturnType<typeof getServiceRoleClient> & { range: ReturnType<typeof vi.fn> };
}

const row = (i: number) => ({
  listing_key: `W${String(i).padStart(8, '0')}`,
  synced_at: '2026-06-10T00:00:00Z',
});

beforeEach(() => vi.clearAllMocks());

describe('sitemap — PostgREST 1000-row pagination (audit HIGH-7)', () => {
  it('emits ALL listings when there are more than 1000 (pages with .range)', async () => {
    const dataset = Array.from({ length: 2500 }, (_, i) => row(i));
    const stub = supabaseReturningSlices(dataset);
    vi.mocked(getServiceRoleClient).mockReturnValue(stub);

    const entries = await sitemap();
    // 2 static routes + every listing
    expect(entries.length).toBe(2 + 2500);
    // PAGE must be ≤ 1000 (PostgREST hard cap) and the loop must have paged ≥ 3 times
    expect(stub.range).toHaveBeenCalledTimes(3);
    const [f0, t0] = stub.range.mock.calls[0];
    expect(t0 - f0 + 1).toBeLessThanOrEqual(1000);
  });

  it('still emits the static routes when the DB read fails', async () => {
    const q: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'order', 'range']) q[m] = vi.fn(() => q);
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: new Error('boom') }));
    vi.mocked(getServiceRoleClient).mockReturnValue(q as unknown as ReturnType<typeof getServiceRoleClient>);

    const entries = await sitemap();
    expect(entries.length).toBe(2);
  });
});
