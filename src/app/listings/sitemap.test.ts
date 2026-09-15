import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));

import { getServiceRoleClient } from '@/lib/supabase/client';
import { LISTING_SHARD_URLS, LISTING_SITEMAP_SHARDS } from '@/lib/listings/listingSitemapShards';
import sitemap, { generateSitemaps } from './sitemap';

interface Row {
  listing_key: string;
  synced_at: string;
  sitemap_path: string | null;
}

/**
 * `pageError` fires on the Nth page, standing in for the statement timeout that silently
 * truncated the live sitemap to 13,998 of 45,000 URLs.
 *
 * `dataset` is indexed by ABSOLUTE offset, so a shard's base offset is exercised for real:
 * shard 1 reading rows it should not see shows up as wrong data, not as a passing test.
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

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('listing sitemap — shard addressing', () => {
  it('declares exactly the shards robots.txt names', async () => {
    // One module feeds both this route and robots.ts. A shard robots names but this does
    // not render is a 404 in Search Console; the reverse is invisible.
    expect(await generateSitemaps()).toEqual(
      Array.from({ length: LISTING_SITEMAP_SHARDS }, (_, id) => ({ id }))
    );
  });

  it('reads from the shardOFFSET, not always from zero', async () => {
    const { client, calls } = supabaseStub([]);
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    await sitemap({ id: 1 });
    expect(calls.ranges[0][0]).toBe(LISTING_SHARD_URLS);
  });

  it('survives the async-`id` trap that shipped every address shard EMPTY', async () => {
    // Next TYPES this param `number`; in Next 16 it is a PROMISE, and awaited it is the
    // raw URL segment "1.xml". Either one made the offset NaN, `.range(NaN, NaN)` fail,
    // and all seven address shards ship empty for three deploys while the build was green.
    const { client, calls } = supabaseStub([]);
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    await sitemap({ id: Promise.resolve('1.xml') as unknown as number });
    expect(calls.ranges[0][0]).toBe(LISTING_SHARD_URLS);
    expect(Number.isNaN(calls.ranges[0][0])).toBe(false);
  });

  it('serves empty and says so, rather than querying offset 0, on an unusable id', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, calls } = supabaseStub([row(1)]);
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    expect(await sitemap({ id: {} as unknown as number })).toEqual([]);
    expect(calls.ranges).toEqual([]); // never reached the database
    expect(err).toHaveBeenCalledWith(expect.stringContaining('not a shard index'));
  });

  it('rejects a shard past the declared count instead of serving a surprise file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getServiceRoleClient).mockReturnValue(supabaseStub([row(1)]).client);
    expect(await sitemap({ id: LISTING_SITEMAP_SHARDS })).toEqual([]);
  });
});

describe('listing sitemap — pagination and canonical URLs', () => {
  it('emits ALL rows in a shard when there are more than 1000 (pages with .range)', async () => {
    const dataset = Array.from({ length: 2500 }, (_, i) => row(i));
    const { client, calls } = supabaseStub(dataset);
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    const entries = await sitemap({ id: 0 });
    expect(entries.length).toBe(2500);
    // PAGE must stay <= 1000 — PostgREST hard-caps one response there and silently
    // truncates anything larger.
    const [f0, t0] = calls.ranges[0];
    expect(t0 - f0 + 1).toBeLessThanOrEqual(1000);
  });

  it('never reads past its own shard', async () => {
    // 2,500 rows exist; shard 0 owns [0, 20000). The guard that matters is the upper
    // bound — a shard that runs off its end duplicates the next shard's URLs.
    const { client, calls } = supabaseStub(Array.from({ length: 2500 }, (_, i) => row(i)));
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    await sitemap({ id: 0 });
    for (const [, to] of calls.ranges) expect(to).toBeLessThan(LISTING_SHARD_URLS);
  });

  it('emits the precomputed canonical, not the legacy /properties/{KEY}', async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(supabaseStub([row(1)]).client);

    const entries = await sitemap({ id: 0 });
    // Must match properties/[id] listingCanonical exactly — a sitemap that declares a
    // non-canonical URL asks Google to index a page it is then told to discard.
    expect(entries[0]?.url).toBe(
      'https://www.pureproperty.ca/property/on/oshawa/2545-simcoe-street-ph20-W00000001'
    );
    expect(entries.some((e) => e.url.includes('/properties/W00000001'))).toBe(false);
  });

  it('NEVER touches full_payload — that detoast broke production twice', async () => {
    const { client, calls } = supabaseStub([row(1)]);
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    await sitemap({ id: 0 });
    // Extracting address fields from jsonb here degraded with offset depth, tripped the
    // 8s statement timeout at ~row 14,000 (live sitemap: 13,998 of 45,000), and blew the
    // 60s prerender cap on Vercel even after a by-key rewrite. Migration 138 moved the
    // path into a column so this select stays flat. It must stay flat.
    for (const s of calls.selects) expect(s).not.toContain('full_payload');
    expect(calls.selects[0]).toContain('sitemap_path');
  });

  it('orders by listing_key, so shard boundaries cannot move between renders', async () => {
    // The three shards do not render at the same instant. Ordering by a column the nightly
    // ETL rewrites (synced_at) would reshuffle the boundaries, and a listing would land in
    // two shards or in none.
    const { client } = supabaseStub([row(1)]);
    const orderSpy: string[] = [];
    const wrapped = {
      from: vi.fn(() => {
        const q = (client as unknown as { from: () => Record<string, unknown> }).from();
        const realOrder = q.order as (c: string) => unknown;
        q.order = vi.fn((c: string) => {
          orderSpy.push(c);
          return realOrder(c);
        });
        return q;
      }),
    } as unknown as ReturnType<typeof getServiceRoleClient>;
    vi.mocked(getServiceRoleClient).mockReturnValue(wrapped);

    await sitemap({ id: 0 });
    expect(orderSpy).toContain('listing_key');
    expect(orderSpy).not.toContain('synced_at');
  });

  it('falls back to /properties/{KEY} when sitemap_path was never computed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(getServiceRoleClient).mockReturnValue(supabaseStub([row(2, { sitemap_path: null })]).client);

    const entries = await sitemap({ id: 0 });
    // A resolvable URL beats a wrong one, and it is the same fallback the listing page
    // uses, so the sitemap and the canonical tag can never disagree.
    expect(entries.some((e) => e.url.endsWith('/properties/W00000002'))).toBe(true);
  });

  it('warns when rows are missing a path instead of shipping them quietly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(getServiceRoleClient).mockReturnValue(
      supabaseStub([row(1), row(2, { sitemap_path: null })]).client
    );

    await sitemap({ id: 0 });
    // Means the backfill has not reached them, or the ingester stopped writing the column.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no sitemap_path'));
  });

  it('reports a truncating error instead of passing it off as the end of the table', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 2,500 rows available, but the SECOND page times out.
    const { client } = supabaseStub(Array.from({ length: 2500 }, (_, i) => row(i)), { pageError: 2 });
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    const entries = await sitemap({ id: 0 });
    expect(entries.length).toBe(1000); // short, as it must be
    // ...but never silently. Silence is what let a 69% shortfall sit live for two days.
    expect(err).toHaveBeenCalledWith(expect.stringContaining('failed at offset'));
  });
});
