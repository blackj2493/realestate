import { describe, it, expect } from 'vitest';

import { LIVE_TRACKERS } from '@/lib/data/trackers';
import { LIVE_FINDINGS } from '@/lib/data/findings';
import sitemap from './sitemap';

const SITE = 'https://www.pureproperty.ca';

describe('/data/sitemap.xml', () => {
  it('declares the hub, the press desk, the findings index, and every live page', () => {
    const urls = sitemap().map((e) => e.url);

    expect(urls).toContain(`${SITE}/data`);
    expect(urls).toContain(`${SITE}/data/for-journalists`);
    expect(urls).toContain(`${SITE}/data/findings`);
    for (const t of LIVE_TRACKERS) expect(urls).toContain(`${SITE}/data/${t.slug}`);
    for (const f of LIVE_FINDINGS) expect(urls).toContain(`${SITE}/data/findings/${f.slug}`);
    expect(urls).toHaveLength(3 + LIVE_TRACKERS.length + LIVE_FINDINGS.length);
  });

  it('declares only /data URLs, so its coverage number means one thing', () => {
    // The entire point of the split is a Search Console row that reports on the data desk
    // and nothing else. One stray listing URL in here makes that number unreadable.
    for (const e of sitemap()) {
      expect(new URL(e.url).pathname.startsWith('/data')).toBe(true);
    }
  });

  it('needs no database, so it cannot fail the way the root sitemap can', () => {
    // No mocks are registered in this file. If this ever starts needing a Supabase stub,
    // the data desk's sitemap has grown a dependency that can empty it during an incident.
    expect(() => sitemap()).not.toThrow();
    expect(sitemap().length).toBeGreaterThan(0);
  });

  it('stamps each finding with its own date, never "now"', () => {
    // A finding is a snapshot. Claiming daily freshness on static analysis is what gets a
    // sitemap discounted wholesale.
    for (const f of LIVE_FINDINGS) {
      const entry = sitemap().find((e) => e.url === `${SITE}/data/findings/${f.slug}`);
      expect(entry?.lastModified).toEqual(new Date(`${f.updated ?? f.published}T12:00:00Z`));
    }
  });
});
