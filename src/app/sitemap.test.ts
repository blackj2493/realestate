import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));

// Hub enumeration is Typesense-backed; stub it (default: no hubs, matching the old
// behavior where searchListings threw without a key) so tests control it per-case.
// Real module is spread so COMMERCIAL_ACTIVE_FILTER stays the genuine constant.
vi.mock('@/lib/listings/cityHubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/listings/cityHubs')>();
  return {
    ...actual,
    cityHubsWithInventory: vi.fn(async () => []),
    neighbourhoodHubsForSitemap: vi.fn(async () => []),
  };
});

import { getServiceRoleClient } from '@/lib/supabase/client';
import { cityHubsWithInventory, COMMERCIAL_ACTIVE_FILTER } from '@/lib/listings/cityHubs';
import { LIVE_TRACKERS } from '@/lib/data/trackers';
import sitemap from './sitemap';

// Non-listing routes always emitted: 3 static (/, /properties, /property) + 2 fixed /data
// pages (the hub and /data/for-journalists) + one route per live tracker. Derived from
// LIVE_TRACKERS so it stays correct as trackers ship.
const NON_LISTING = 3 + 2 + LIVE_TRACKERS.length;

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
    // static + /data routes + every listing. Hub routes are [] here: searchListings throws
    // without a Typesense key, caught best-effort.
    expect(entries.length).toBe(NON_LISTING + 2500);
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
    // static + /data routes survive a DB failure (listing read is what fails).
    expect(entries.length).toBe(NON_LISTING);
  });

  it('emits /commercial/on/{slug} hubs counted over the commercial population', async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(supabaseReturningSlices([row(1)]));
    // Only the commercial-population call yields a hub; every residential-tree call
    // (default base) stays empty — proving the URL comes from the commercial branch.
    vi.mocked(cityHubsWithInventory).mockImplementation(
      async (_min: number, _extraFilter?: string, baseFilter?: string) =>
        baseFilter === COMMERCIAL_ACTIVE_FILTER ? [{ slug: 'mississauga', count: 382 }] : []
    );

    const entries = await sitemap();
    expect(entries.some((e) => e.url.endsWith('/commercial/on/mississauga'))).toBe(true);
    expect(entries.some((e) => e.url.includes('/property/on/'))).toBe(false);
  });
});
