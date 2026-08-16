/**
 * Guards the findings registry's contracts.
 *
 * These are cheap assertions about things that fail expensively: a cited URL that
 * 404s, a finding whose tracker was renamed out from under it, or a date typo that
 * puts a piece at the wrong end of the index. The novelty-claim rule is covered
 * separately by noveltyClaims.test.ts, which already walks src/app/data.
 */
import { describe, it, expect } from 'vitest';
import { FINDINGS, LIVE_FINDINGS, findingBySlug, findingsForTracker } from './findings';
import { TRACKERS, trackerBySlug } from './trackers';

describe('findings registry', () => {
  it('has no duplicate slugs', () => {
    const slugs = FINDINGS.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses URL-safe slugs', () => {
    for (const f of FINDINGS) {
      expect(f.slug, `${f.slug} is not a clean slug`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('points every finding at a tracker that exists', () => {
    // The architecture in one assertion: a finding with no live data behind it is an
    // opinion piece. It also catches a tracker slug renamed without updating findings.
    for (const f of FINDINGS) {
      const tracker = trackerBySlug(f.trackerSlug);
      expect(tracker, `finding "${f.slug}" references unknown tracker "${f.trackerSlug}"`).toBeDefined();
    }
  });

  it('only points live findings at live trackers', () => {
    // A live finding linking to a "soon" tracker would send a reporter to a page that
    // does not exist yet.
    for (const f of LIVE_FINDINGS) {
      expect(trackerBySlug(f.trackerSlug)?.status, `finding "${f.slug}"`).toBe('live');
    }
  });

  it('stamps a real ISO date on every finding', () => {
    for (const f of FINDINGS) {
      expect(f.published, `${f.slug} published`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(f.published)), `${f.slug} published`).toBe(false);
      if (f.updated) {
        expect(f.updated, `${f.slug} updated`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(f.updated >= f.published, `${f.slug} updated precedes published`).toBe(true);
      }
    }
  });

  it('orders the index newest first', () => {
    const dates = LIVE_FINDINGS.map((f) => f.published);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it('carries the numbers in the standfirst, which is what gets quoted', () => {
    for (const f of LIVE_FINDINGS) {
      expect(/\d/.test(f.standfirst), `${f.slug} standfirst has no figure in it`).toBe(true);
    }
  });

  it('keeps descriptions inside a useful meta length', () => {
    for (const f of LIVE_FINDINGS) {
      expect(f.description.length, `${f.slug} description too short`).toBeGreaterThan(70);
      expect(f.description.length, `${f.slug} description too long`).toBeLessThan(320);
    }
  });

  it('resolves lookups both ways', () => {
    for (const f of LIVE_FINDINGS) {
      expect(findingBySlug(f.slug)).toBe(f);
      expect(findingsForTracker(f.trackerSlug)).toContain(f);
    }
    expect(findingBySlug('does-not-exist')).toBeUndefined();
    expect(findingsForTracker('does-not-exist')).toEqual([]);
  });

  it('never returns a draft from the live helpers', () => {
    for (const f of LIVE_FINDINGS) expect(f.status).toBe('live');
    for (const t of TRACKERS) {
      for (const f of findingsForTracker(t.slug)) expect(f.status).toBe('live');
    }
  });
});
