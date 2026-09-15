import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { cityHubsWithInventory, COMMERCIAL_ACTIVE_FILTER } from '@/lib/listings/cityHubs';
import { LIVE_TRACKERS } from '@/lib/data/trackers';
import { LIVE_FINDINGS } from '@/lib/data/findings';
import sitemap from './sitemap';

// This file now declares STATIC and HUB routes only: /, /properties, /property.
//
// Two trees moved out on 2026-09-15, both because it had reached 47,646 of the protocol's
// 50,000-URL cap — where Google rejects the WHOLE file, not the overflow:
//   • /data  → src/app/data/sitemap.ts     (also so its coverage row is readable)
//   • listings → src/app/listings/sitemap.ts (sharded; the part that grows with the market)
// Their behaviour is tested in those files. What is tested HERE is that they stay out.
const STATIC_ROUTES = 3;

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations, so the commercial case's hub stub would leak
  // one extra URL into every test declared after it. Reset it to the module default.
  vi.mocked(cityHubsWithInventory).mockImplementation(async () => []);
});
afterEach(() => vi.restoreAllMocks());

describe('sitemap — the split is held', () => {
  it('declares no listing URL — those have their own sharded sitemap', async () => {
    // Re-adding them is how this file creeps back to the cap. It is also how the
    // per-sitemap coverage numbers in Search Console stop meaning anything, because two
    // sitemaps would claim the same URL.
    const entries = await sitemap();
    expect(entries.some((e) => /\/properties\/[A-Z]\d+/.test(e.url))).toBe(false);
    expect(entries.some((e) => /-[A-Z]\d{8}$/.test(e.url))).toBe(false);
  });

  it('declares no /data URL — that tree has its own sitemap', async () => {
    const entries = await sitemap();
    const dataUrls = entries.filter((e) => new URL(e.url).pathname.startsWith('/data'));
    expect(dataUrls).toEqual([]);
    // And the tree it moved to is non-empty, so this is a split and not a deletion.
    expect(LIVE_TRACKERS.length + LIVE_FINDINGS.length).toBeGreaterThan(0);
  });

  it('touches no database at all now that the listing read has moved', async () => {
    // The root sitemap used to page through `listings` on every render. If a DB call
    // reappears here, the cap problem is quietly coming back with it.
    const entries = await sitemap();
    expect(entries.length).toBe(STATIC_ROUTES);
  });
});

describe('sitemap — hub routes', () => {
  it('emits the three static entry points', async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://www.pureproperty.ca/');
    expect(urls).toContain('https://www.pureproperty.ca/properties');
    // /property = the crawlable city directory; /properties is the client-only terminal
    // Googlebot cannot crawl, which is why the directory has to exist separately.
    expect(urls).toContain('https://www.pureproperty.ca/property');
  });

  it('emits /commercial/on/{slug} hubs counted over the commercial population', async () => {
    vi.mocked(cityHubsWithInventory).mockImplementation(
      async (_min: number, _extraFilter?: string, baseFilter?: string) =>
        baseFilter === COMMERCIAL_ACTIVE_FILTER ? [{ slug: 'mississauga', count: 382 }] : []
    );

    const entries = await sitemap();
    expect(entries.some((e) => e.url.endsWith('/commercial/on/mississauga'))).toBe(true);
    // No RESIDENTIAL hub — a hub is /property/on/{city} with no key-bearing tail.
    expect(entries.some((e) => /\/property\/on\/[^/]+$/.test(e.url))).toBe(false);
  });
});
