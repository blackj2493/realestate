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
  [k: string]: string | null;
}

/**
 * Two-pass stub. The route pages KEYS with flat columns and an offset, then fetches the
 * address fields BY KEY with `.in()` — so this dispatches on which call shape it was
 * handed, exactly as PostgREST would.
 *
 * `keyPageError` fires on the Nth key page, standing in for the statement timeout that
 * silently truncated the live sitemap to 13,998 of 45,000 URLs.
 */
function supabaseTwoPass(dataset: Row[], opts: { keyPageError?: number; addressError?: boolean } = {}) {
  const calls = {
    selects: [] as string[],
    rangedSelects: [] as string[],
    ranges: [] as [number, number][],
    inChunks: [] as number[],
  };
  let keyPages = 0;

  const make = () => {
    let select = '';
    let from = 0;
    let to = 0;
    let keys: string[] | null = null;
    const q: Record<string, unknown> = {};
    q.select = vi.fn((s: string) => {
      select = s;
      calls.selects.push(s);
      return q;
    });
    q.order = vi.fn(() => q);
    q.range = vi.fn((f: number, t: number) => {
      from = f;
      to = t;
      calls.ranges.push([f, t]);
      calls.rangedSelects.push(select);
      return q;
    });
    q.in = vi.fn((_col: string, chunk: string[]) => {
      keys = chunk;
      calls.inChunks.push(chunk.length);
      return q;
    });
    q.then = (resolve: (v: unknown) => unknown) => {
      if (keys) {
        if (opts.addressError) return Promise.resolve(resolve({ data: null, error: new Error('address boom') }));
        const set = new Set(keys);
        return Promise.resolve(resolve({ data: dataset.filter((r) => set.has(r.listing_key)), error: null }));
      }
      keyPages++;
      if (opts.keyPageError && keyPages === opts.keyPageError) {
        return Promise.resolve(
          resolve({ data: null, error: new Error('canceling statement due to statement timeout') })
        );
      }
      return Promise.resolve(resolve({ data: dataset.slice(from, to + 1), error: null }));
    };
    return q;
  };

  // Each .from() starts a fresh builder so pass 2's chunks don't inherit pass 1's range.
  const client = { from: vi.fn(() => make()) } as unknown as ReturnType<typeof getServiceRoleClient>;
  return { client, calls };
}

const row = (i: number): Row => ({
  listing_key: `W${String(i).padStart(8, '0')}`,
  synced_at: '2026-06-10T00:00:00Z',
  street_number: '2545',
  street_name: 'Simcoe',
  street_suffix: 'Street',
  street_dir_prefix: null,
  street_dir_suffix: null,
  unit_number: 'PH20',
  apartment_number: null,
  unparsed_address: '2545 Simcoe Street PH20, Oshawa, ON L1H 7K4',
  payload_city: 'Oshawa',
  state_or_province: 'ON',
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
    const { client, calls } = supabaseTwoPass(dataset);
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    const entries = await sitemap();
    expect(entries.length).toBe(NON_LISTING + 2500);
    // PAGE must be <= 1000 (PostgREST hard cap) and the key pass must have paged >= 3 times
    expect(calls.ranges.length).toBe(3);
    const [f0, t0] = calls.ranges[0];
    expect(t0 - f0 + 1).toBeLessThanOrEqual(1000);
  });

  it('still emits the static routes when the DB read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = supabaseTwoPass([], { keyPageError: 1 });
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    const entries = await sitemap();
    expect(entries.length).toBe(NON_LISTING);
  });

  it('emits /commercial/on/{slug} hubs counted over the commercial population', async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(supabaseTwoPass([row(1)]).client);
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
  it('emits /property/{prov}/{city}/{address}-{KEY}, not the legacy /properties/{KEY}', async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(supabaseTwoPass([row(1)]).client);

    const entries = await sitemap();
    const listing = entries.find((e) => e.url.includes('W00000001'));
    // Must match properties/[id] listingCanonical exactly — a sitemap that declares a
    // non-canonical URL asks Google to index a page it is then told to discard.
    expect(listing?.url).toBe(
      'https://www.pureproperty.ca/property/on/oshawa/2545-simcoe-street-ph20-W00000001'
    );
    expect(entries.some((e) => e.url.includes('/properties/W00000001'))).toBe(false);
  });

  it('never pairs the jsonb address fields with an offset', async () => {
    const { client, calls } = supabaseTwoPass(Array.from({ length: 1500 }, (_, i) => row(i)));
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    await sitemap();
    // THE regression. Selecting ten `full_payload->>` fields alongside .range() degrades
    // with depth and hit the 8s statement timeout around row 14,000 in production, which
    // the loop read as "no more rows" — the live sitemap carried 13,998 of 45,000.
    // The ranged pass must stay flat; the detoast rides on .in() only.
    for (const s of calls.rangedSelects) expect(s).not.toContain('full_payload');
    expect(calls.selects.some((s) => s.includes('street_name:full_payload->>StreetName'))).toBe(true);
    expect(calls.inChunks.length).toBeGreaterThan(0);
  });

  it('reports a truncating error instead of passing it off as the end of the table', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 2,500 rows available, but the SECOND key page times out.
    const { client } = supabaseTwoPass(Array.from({ length: 2500 }, (_, i) => row(i)), { keyPageError: 2 });
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    const entries = await sitemap();
    expect(entries.length).toBe(NON_LISTING + 1000); // short, as it must be
    // ...but never silently. Silence is what let a 69% shortfall sit live.
    expect(err).toHaveBeenCalledWith(expect.stringContaining('listing key page failed'));
  });

  it('keeps a URL for a listing whose address chunk failed, rather than dropping it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = supabaseTwoPass([row(1)], { addressError: true });
    vi.mocked(getServiceRoleClient).mockReturnValue(client);

    const entries = await sitemap();
    // Falls back to the legacy path — dropping it would reintroduce the same shortfall.
    expect(entries.some((e) => e.url.endsWith('/properties/W00000001'))).toBe(true);
  });
});
