import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));

import { getServiceRoleClient } from '@/lib/supabase/client';
import {
  LISTING_SHARD_URLS,
  LISTING_SITEMAP_SHARDS,
  LISTING_ACTIVE_STATUSES,
} from '@/lib/listings/listingSitemapShards';
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
  const calls = {
    selects: [] as string[],
    /** the SEEK only — `.range(base, base)` to find a shard's first key */
    ranges: [] as [number, number][],
    /** every keyset page: the cursor and whether the boundary key is included */
    cursors: [] as { key: string; inclusive: boolean }[],
    limits: [] as number[],
  };
  let pages = 0;

  const make = () => {
    let from = 0;
    let to = 0;
    let cursor: string | null = null;
    let inclusive = false;
    let lim = dataset.length;
    const q: Record<string, unknown> = {};
    q.select = vi.fn((s: string) => {
      calls.selects.push(s);
      return q;
    });
    q.in = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.order = vi.fn(() => q);
    q.range = vi.fn((f: number, t: number) => {
      from = f;
      to = t;
      calls.ranges.push([f, t]);
      return q;
    });
    // Keyset. `.gte` is the first page of a shard (it must INCLUDE the key the seek
    // returned); `.gt` is every page after it.
    q.gte = vi.fn((_c: string, v: string) => {
      cursor = v;
      inclusive = true;
      calls.cursors.push({ key: v, inclusive: true });
      return q;
    });
    q.gt = vi.fn((_c: string, v: string) => {
      cursor = v;
      inclusive = false;
      calls.cursors.push({ key: v, inclusive: false });
      return q;
    });
    q.limit = vi.fn((n: number) => {
      lim = n;
      calls.limits.push(n);
      return q;
    });
    q.then = (resolve: (v: unknown) => unknown) => {
      pages++;
      if (opts.pageError && pages === opts.pageError) {
        return Promise.resolve(
          resolve({ data: null, error: new Error('canceling statement due to statement timeout') })
        );
      }
      // A seek asks for a single absolute offset; everything else walks by key.
      if (cursor === null && calls.cursors.length === 0 && to >= from && calls.limits.length === 0) {
        return Promise.resolve(resolve({ data: dataset.slice(from, to + 1), error: null }));
      }
      const c = cursor;
      const eligible = c === null ? dataset : dataset.filter((r) => (inclusive ? r.listing_key >= c : r.listing_key > c));
      return Promise.resolve(resolve({ data: eligible.slice(0, lim), error: null }));
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

  it('SEEKS to its own shard boundary, not always to zero', async () => {
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
  it('emits ALL rows in a shard when there are more than 1000 (keyset pages)', async () => {
    const dataset = Array.from({ length: 2500 }, (_, i) => row(i));
    const { client, calls } = supabaseStub(dataset);
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    const entries = await sitemap({ id: 0 });
    expect(entries.length).toBe(2500);
    // PAGE must stay <= 1000 — PostgREST hard-caps one response there and silently
    // truncates anything larger.
    for (const n of calls.limits) expect(n).toBeLessThanOrEqual(1000);
  });

  it('walks by KEYSET, never by a deepening OFFSET', async () => {
    // THE regression this replaces. With the partial index (migration 148) in place and
    // being USED, offset paging still read and heap-visited every discarded row:
    //     OFFSET 40000 → rows=41000, 4,568 ms   vs   KEYSET → rows=1000, 1.8 ms
    // Past ~20,000 that crossed the 8s statement timeout, so shard 0 died mid-slice and
    // shards 1-2 died on their first page: 12,000 of 104,889 URLs, two files empty.
    const { client, calls } = supabaseStub(Array.from({ length: 2500 }, (_, i) => row(i)));
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    await sitemap({ id: 0 });
    // Shard 0 starts at the beginning, so it needs no seek at all.
    expect(calls.ranges).toEqual([]);
    expect(calls.cursors.length).toBeGreaterThan(0);
    // The first page of a shard must INCLUDE its boundary key; later pages must not, or
    // the row on the boundary is emitted twice.
    expect(calls.cursors.filter((c) => c.inclusive).length).toBeLessThanOrEqual(1);
  });

  it('never emits more than its own shard holds', async () => {
    // A shard that runs off its end duplicates the next shard's URLs.
    const { client } = supabaseStub(Array.from({ length: 2500 }, (_, i) => row(i)));
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    const entries = await sitemap({ id: 0 });
    expect(entries.length).toBeLessThanOrEqual(LISTING_SHARD_URLS);
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

  it('declares ON-MARKET rows only, never sold or leased ones', async () => {
    // 130,917 of 327,723 rows are sold or leased, and the listing page noindexes every
    // one. Without this filter ~40% of the sitemap asks Google to fetch pages it is then
    // told to discard — the exact crawl budget that left /data uncrawled for two months.
    const filters: Array<[string, unknown]> = [];
    const { client } = supabaseStub([row(1)]);
    const wrapped = {
      from: vi.fn(() => {
        const q = (client as unknown as { from: () => Record<string, unknown> }).from();
        q.in = vi.fn((col: string, vals: unknown) => {
          filters.push([col, vals]);
          return q;
        });
        q.eq = vi.fn((col: string, val: unknown) => {
          filters.push([col, val]);
          return q;
        });
        return q;
      }),
    } as unknown as ReturnType<typeof getServiceRoleClient>;
    vi.mocked(getServiceRoleClient).mockReturnValue(wrapped);

    await sitemap({ id: 0 });
    const statuses = filters.find(([c]) => c === 'standard_status')?.[1] as string[];
    expect(statuses).toEqual([...LISTING_ACTIVE_STATUSES]);
    expect(statuses).not.toContain('sold');
    expect(statuses).not.toContain('leased');
    // Orphans are rows the feed stopped sending; they resolve to nothing worth indexing.
    expect(filters).toContainEqual(['is_orphaned', false]);
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
    // The message must say HOW FAR it got — a bare "failed" gives no way to tell a
    // timeout apart from a shard that legitimately ran out of rows.
    expect(err).toHaveBeenCalledWith(expect.stringContaining('failed after 1000 rows'));
  });
});
