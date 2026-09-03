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
import { LIVE_FINDINGS } from '@/lib/data/findings';
import sitemap from './sitemap';

// Non-listing routes always emitted: 3 static (/, /properties, /property) + 3 fixed /data
// pages (the hub, /data/for-journalists, /data/findings) + one route per live tracker and
// one per live finding. Derived from the registries so it stays correct as pages ship.
const NON_LISTING = 3 + 3 + LIVE_TRACKERS.length + LIVE_FINDINGS.length;

type Row = Record<string, string | null>;

/** Chainable stub whose range(from, to) returns a slice of `dataset`,
 *  mimicking PostgREST range pagination (then-only thenable). */
function supabaseReturningSlices(dataset: Row[]) {
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

// The street fields arrive flattened out of full_payload by LISTING_SELECT's
// `alias:col->>Key` projection, so the fixture mirrors that shape, not the raw JSONB.
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
    // No RESIDENTIAL hub — a hub is /property/on/{city} with no key-bearing tail, which
    // is what distinguishes it from the listing URLs this sitemap also emits.
    expect(entries.some((e) => /\/property\/on\/[^/]+$/.test(e.url))).toBe(false);
  });
});

describe('sitemap — listings are declared under their canonical URL', () => {
  it('emits /property/{prov}/{city}/{address}-{KEY}, not the legacy /properties/{KEY}', async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(supabaseReturningSlices([row(1)]));

    const entries = await sitemap();
    const listing = entries.find((e) => e.url.includes('W00000001'));
    // Must match properties/[id] listingCanonical exactly — a sitemap that declares a
    // non-canonical URL asks Google to index a page it is then told to discard.
    expect(listing?.url).toBe(
      'https://www.pureproperty.ca/property/on/oshawa/2545-simcoe-street-ph20-W00000001'
    );
    expect(entries.some((e) => e.url.includes('/properties/W00000001'))).toBe(false);
  });

  it('selects the street fields out of full_payload rather than the whole JSONB', async () => {
    const stub = supabaseReturningSlices([row(1)]);
    vi.mocked(getServiceRoleClient).mockReturnValue(stub);

    await sitemap();
    const select = (stub as unknown as { select: ReturnType<typeof vi.fn> }).select.mock.calls[0][0] as string;
    expect(select).toContain('street_name:full_payload->>StreetName');
    // Pulling the whole payload would detoast 45,000 rows on every daily rebuild.
    expect(select).not.toMatch(/(^|[\s,])full_payload([\s,]|$)/);
  });

  it('falls back to /properties/{KEY} when the payload cannot form a slug', async () => {
    // A key that fails buildListingPath's KEY_RE — the one field it cannot synthesize.
    vi.mocked(getServiceRoleClient).mockReturnValue(
      supabaseReturningSlices([{ ...row(2), listing_key: 'not-a-key' }])
    );

    const entries = await sitemap();
    expect(entries.some((e) => e.url.endsWith('/properties/not-a-key'))).toBe(true);
  });
});
