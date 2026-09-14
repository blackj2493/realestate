import { describe, it, expect } from 'vitest';

import { escapeXml, feedDate, dataDateKey, renderRss } from '@/lib/data/rss';

const item = (over: Partial<Parameters<typeof renderRss>[0]['items'][number]> = {}) => ({
  title: 'Price cuts',
  link: 'https://www.pureproperty.ca/data/price-cuts',
  description: 'Vaughan leads at 31.2%.',
  guid: 'https://www.pureproperty.ca/data/price-cuts#2026-09-14',
  pubDate: new Date('2026-09-14T00:00:00Z'),
  ...over,
});

describe('escapeXml', () => {
  it('escapes every character that would break a text node or an attribute', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  it('escapes the ampersand first, so an entity is never double-built', () => {
    // A naive ordering turns "<" into "&lt;" and then the "&" into "&amp;lt;".
    expect(escapeXml('a<b')).toBe('a&lt;b');
    expect(escapeXml('Tim & Co <ON>')).toBe('Tim &amp; Co &lt;ON&gt;');
  });
});

describe('feedDate', () => {
  it('reads a bare data date as UTC midnight, not local midnight', () => {
    // A local reading shifts the stamp a day in either direction depending on the
    // server's zone, which silently reorders items in every subscriber's reader.
    expect(feedDate('2026-09-14').toISOString()).toBe('2026-09-14T00:00:00.000Z');
  });

  it('passes a full timestamp through', () => {
    expect(feedDate('2026-09-14T11:30:00Z').toISOString()).toBe('2026-09-14T11:30:00.000Z');
  });

  it('falls back to now rather than throwing when the precompute has no stamp', () => {
    for (const bad of [null, undefined, '', 'not-a-date']) {
      expect(Number.isNaN(feedDate(bad).getTime())).toBe(false);
    }
  });
});

describe('dataDateKey', () => {
  it('collapses any stamp from one nightly refresh to a single guid key', () => {
    expect(dataDateKey('2026-09-14T03:17:00Z')).toBe('2026-09-14');
    expect(dataDateKey('2026-09-14')).toBe('2026-09-14');
  });
});

describe('renderRss', () => {
  const base = {
    title: 'PureProperty Data Desk',
    description: 'Ontario housing market readings.',
    selfUrl: 'https://www.pureproperty.ca/data/feeds/rss.xml',
    link: 'https://www.pureproperty.ca/data',
  };

  it('emits a well-formed channel with the atom self link validators require', () => {
    const xml = renderRss({ ...base, items: [item()] });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    expect(xml).toContain(
      '<atom:link href="https://www.pureproperty.ca/data/feeds/rss.xml" rel="self" type="application/rss+xml" />'
    );
    expect(xml).toContain('<language>en-CA</language>');
  });

  it('marks a synthetic reading guid as a non-permalink and a finding as a permalink', () => {
    const xml = renderRss({
      ...base,
      items: [item(), item({ guid: 'https://www.pureproperty.ca/data/findings/x', isPermaLink: true })],
    });
    expect(xml).toContain('<guid isPermaLink="false">https://www.pureproperty.ca/data/price-cuts#2026-09-14</guid>');
    expect(xml).toContain('<guid isPermaLink="true">https://www.pureproperty.ca/data/findings/x</guid>');
  });

  it('escapes item content, so an ampersand in a market name cannot break the feed', () => {
    const xml = renderRss({
      ...base,
      items: [item({ title: 'Dundas & Bay', description: '31% <of> listings cut' })],
    });
    expect(xml).toContain('<title>Dundas &amp; Bay</title>');
    expect(xml).toContain('<description>31% &lt;of&gt; listings cut</description>');
    expect(xml).not.toContain('<description>31% <of>');
  });

  it('stamps pubDate in RFC-822, which is what RSS 2.0 requires', () => {
    const xml = renderRss({ ...base, items: [item()] });
    expect(xml).toContain('<pubDate>Mon, 14 Sep 2026 00:00:00 GMT</pubDate>');
  });

  it('defaults lastBuildDate to the newest item rather than to now', () => {
    const xml = renderRss({
      ...base,
      items: [
        item({ pubDate: new Date('2026-09-10T00:00:00Z') }),
        item({ pubDate: new Date('2026-09-14T00:00:00Z') }),
      ],
    });
    expect(xml).toContain('<lastBuildDate>Mon, 14 Sep 2026 00:00:00 GMT</lastBuildDate>');
  });

  it('renders a channel with no items rather than throwing', () => {
    // A board that returns nothing must degrade to an empty feed: an outreach URL that
    // 500s is worse than one that is briefly empty.
    const xml = renderRss({ ...base, items: [] });
    expect(xml).toContain('<channel>');
    expect(xml).not.toContain('<item>');
  });
});
