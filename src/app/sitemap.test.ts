import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
import { LIVE_FINDINGS } from '@/lib/data/findings';
import sitemap from './sitemap';

// Non-listing routes always emitted: 3 static (/, /properties, /property) + 3 fixed /data
// pages (the hub, /data/for-journalists, /data/findings) + one route per live tracker and
// one per live finding. Derived from the registries so it stays correct as pages ship.
const NON_LISTING = 3 + 3 + LIVE_TRACKERS.length + LIVE_FINDINGS.length;

interface Row {
  listing_key: string;
  synced_at: string;
  sitemap_path: string | null;
}

/**
 * `pageError` fires on the Nth page, standing in for the statement timeout that silently
 * truncated the live sitemap to 13,998 of 45,000 URLs.
 */
function supabaseStub(dataset: Row[], opts: { pageError?: number } = {}) {
  const calls = { selects: [] as string[], ranges: [] as [number, number][] };
  let pages = 0;

  const make = () => {
    let from = 0;
    let to = 0;
    const q: Record<string, unknown> = {};
    q.select = vi.fn((s: string) => {
      calls.selects.push(s);
      return q;
    });
    q.order = vi.fn(() => q);
    q.range = vi.fn((f: number, t: number) => {
      from = f;
      to = t;
      calls.ranges.push([f, t]);
      return q;
    });
    q.then = (resolve: (v: unknown) => unknown) => {
      pages++;
      if (opts.pageError && pages === opts.pageError) {
        return Promise.resolve(
          resolve({ data: null, error: new Error('canceling statement due to statement timeout') })
        );
      }
      return Promise.resolve(resolve({ data: dataset.slice(from, to + 1), error: null }));
    };
    return q;
  };

  const client = { from: vi.fn(() => make()) } as unknown as ReturnType<typeof getServiceRoleClient>;
  return { client, calls };
}

const row = (i: number, over: Partial<Row> = {}): Row => ({
  listing_key: `W${String(i).padStart(8, '0')}`,
  synced_at: '2026-06-10T00:00:00Z',
  sitemap_path: `/property/on/oshawa/2545-simcoe-street-ph20-W${String(i).padStart(8, '0')}`,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations, so the commercial case's hub stub would leak
  // one extra URL into every test declared after it. Reset it to the module default.
  vi.mocked(cityHubsWithInventory).mockImplementation(async () => []);
});
afterEach(() => vi.restoreAllMocks());

describe('sitemap — PostgREST 1000-row pagination (audit HIGH-7)', () => {
  it('emits ALL listings when there are more than 1000 (pages with .range)', async () => {
    const dataset = Array.from({ length: 2500 }, (_, i) => row(i));
    const { client, calls } = supabaseStub(dataset);
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    const entries = await sitemap();
    expect(entries.length).toBe(NON_LISTING + 2500);
    // PAGE must be <= 1000 (PostgREST hard cap) and the loop must have paged >= 3 times
    expect(calls.ranges.length).toBe(3);
    const [f0, t0] = calls.ranges[0];
    expect(t0 - f0 + 1).toBeLessThanOrEqual(1000);
  });

  it('still emits the static routes when the DB read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = supabaseStub([], { pageError: 1 });
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    const entries = await sitemap();
    expect(entries.length).toBe(NON_LISTING);
  });

  it('emits /commercial/on/{slug} hubs counted over the commercial population', async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(supabaseStub([row(1)]).client);
    vi.mocked(cityHubsWithInventory).mockImplementation(
      async (_min: number, _extraFilter?: string, baseFilter?: string) =>
        baseFilter === COMMERCIAL_ACTIVE_FILTER ? [{ slug: 'mississauga', count: 382 }] : []
    );

    const entries = await sitemap();
    expect(entries.some((e) => e.url.endsWith('/commercial/on/mississauga'))).toBe(true);
    // No RESIDENTIAL hub — a hub is /property/on/{city} with no key-bearing tail, which
    // is what distinguishes it from the listing URLs this sitemap also emits.
    expect(entries.some((e) => /\/property\/on\/[^/]+$/.test(e.url))).toBe(false);
  });
});

describe('sitemap — listings are declared under their canonical URL', () => {
  it('emits the precomputed canonical, not the legacy /properties/{KEY}', async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(supabaseStub([row(1)]).client);

    const entries = await sitemap();
    const listing = entries.find((e) => e.url.includes('W00000001'));
    // Must match properties/[id] listingCanonical exactly — a sitemap that declares a
    // non-canonical URL asks Google to index a page it is then told to discard.
    expect(listing?.url).toBe(
      'https://www.pureproperty.ca/property/on/oshawa/2545-simcoe-street-ph20-W00000001'
    );
    expect(entries.some((e) => e.url.includes('/properties/W00000001'))).toBe(false);
  });

  it('NEVER touches full_payload — that detoast broke production twice', async () => {
    const { client, calls } = supabaseStub([row(1)]);
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    await sitemap();
    // Extracting address fields from jsonb here degraded with offset depth, tripped the
    // 8s statement timeout at ~row 14,000 (live sitemap: 13,998 of 45,000), and blew the
    // 60s prerender cap on Vercel even after a by-key rewrite. Migration 138 moved the
    // path into a column so this select stays flat. It must stay flat.
    for (const s of calls.selects) expect(s).not.toContain('full_payload');
    expect(calls.selects[0]).toContain('sitemap_path');
  });

  it('falls back to /properties/{KEY} when sitemap_path was never computed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(getServiceRoleClient).mockReturnValue(supabaseStub([row(2, { sitemap_path: null })]).client);

    const entries = await sitemap();
    // A resolvable URL beats a wrong one, and it is the same fallback the listing page
    // uses, so the sitemap and the canonical tag can never disagree.
    expect(entries.some((e) => e.url.endsWith('/properties/W00000002'))).toBe(true);
  });

  it('warns when rows are missing a path instead of shipping them quietly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(getServiceRoleClient).mockReturnValue(supabaseStub([row(1), row(2, { sitemap_path: null })]).client);

    await sitemap();
    // Means the backfill has not reached them, or the ingester stopped writing the column.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no sitemap_path'));
  });

  it('reports a truncating error instead of passing it off as the end of the table', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 2,500 rows available, but the SECOND page times out.
    const { client } = supabaseStub(Array.from({ length: 2500 }, (_, i) => row(i)), { pageError: 2 });
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    const entries = await sitemap();
    expect(entries.length).toBe(NON_LISTING + 1000); // short, as it must be
    // ...but never silently. Silence is what let a 69% shortfall sit live.
    expect(err).toHaveBeenCalledWith(expect.stringContaining('listing page failed'));
  });
});
