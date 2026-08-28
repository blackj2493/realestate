import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readExpandedSections,
  isSectionExpanded,
  noSectionChoiceMade,
  setSectionExpanded,
} from './sectionState';

/**
 * vitest runs `environment: 'node'`, so there is no window. These install a minimal
 * localStorage on globalThis — enough to exercise the read/write/evict contract, which
 * is the part that decides whether a section the user opened is open again tomorrow.
 */
function installStorage(seed?: string) {
  const store = new Map<string, string>();
  if (seed !== undefined) store.set('pp_dashboard_sections', seed);
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  return store;
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('readExpandedSections', () => {
  it('returns an empty set during SSR — no window, no throw', () => {
    expect(readExpandedSections().size).toBe(0);
  });

  it('returns an empty set when nothing is stored', () => {
    installStorage();
    expect(readExpandedSections().size).toBe(0);
  });

  it('survives malformed JSON rather than taking down the dashboard', () => {
    installStorage('{not json');
    expect(readExpandedSections().size).toBe(0);
  });

  it('ignores a stored value of the wrong shape', () => {
    // An older/other writer, or a hand-edited value. "All collapsed" is the safe read.
    installStorage('{"bubble:a":true}');
    expect(readExpandedSections().size).toBe(0);
  });

  it('drops non-string entries but keeps the valid ones', () => {
    installStorage('["city:Barrhaven", 42, null, "bubble:abc"]');
    expect([...readExpandedSections()]).toEqual(['city:Barrhaven', 'bubble:abc']);
  });
});

describe('setSectionExpanded', () => {
  beforeEach(() => installStorage());

  it('round-trips one section', () => {
    setSectionExpanded('bubble:abc', true);
    expect(isSectionExpanded('bubble:abc')).toBe(true);
  });

  it('collapsing removes the key rather than storing false', () => {
    setSectionExpanded('bubble:abc', true);
    setSectionExpanded('bubble:abc', false);
    expect(isSectionExpanded('bubble:abc')).toBe(false);
    expect(readExpandedSections().size).toBe(0);
  });

  it('keeps sections independent', () => {
    setSectionExpanded('bubble:abc', true);
    setSectionExpanded('city:Barrhaven', true);
    setSectionExpanded('bubble:abc', false);
    expect(isSectionExpanded('city:Barrhaven')).toBe(true);
    expect(isSectionExpanded('bubble:abc')).toBe(false);
  });

  it('namespaces the kinds so a bubble cannot answer for a city of the same name', () => {
    setSectionExpanded('city:Vaughan', true);
    expect(isSectionExpanded('bubble:Vaughan')).toBe(false);
  });

  it('is a no-op without a key — persistence is opt-in', () => {
    setSectionExpanded(undefined, true);
    expect(readExpandedSections().size).toBe(0);
  });

  it('evicts the OLDEST key past the cap, never the one just opened', () => {
    // Deleted bubbles leave keys behind and nothing can know they are gone; the cap
    // bounds that drift. Re-touching a key must move it to the newest end, or the
    // eviction would throw away the section the user is looking at.
    for (let i = 0; i < 60; i++) setSectionExpanded(`city:${i}`, true);
    setSectionExpanded('city:0', true); // re-touch the oldest
    setSectionExpanded('bubble:new', true); // pushes over the cap

    const open = readExpandedSections();
    expect(open.size).toBe(60);
    expect(open.has('bubble:new')).toBe(true);
    expect(open.has('city:0')).toBe(true); // re-touched, so it survives
    expect(open.has('city:1')).toBe(false); // now the oldest, so it goes
  });

  it('swallows a quota error — the panel still opens, it just forgets', () => {
    (globalThis as unknown as { window: { localStorage: { setItem: unknown } } }).window.localStorage.setItem =
      () => {
        throw new Error('QuotaExceededError');
      };
    expect(() => setSectionExpanded('bubble:abc', true)).not.toThrow();
  });
});

describe('isSectionExpanded', () => {
  it('is false during SSR, so the server and the client agree on collapsed', () => {
    expect(isSectionExpanded('bubble:abc')).toBe(false);
  });

  it('rejects an over-long key instead of storing it', () => {
    installStorage();
    setSectionExpanded('x'.repeat(201), true);
    expect(readExpandedSections().size).toBe(0);
  });
});

/**
 * The gate on the one section that opens itself on a first visit. Getting this wrong in
 * either direction is costly: too eager and every visit re-fires an area's ~9 requests
 * for a user who has already said no by closing it; too shy and nobody ever sees the
 * open state, which is the whole reason the row reads as a heading.
 */
describe('noSectionChoiceMade', () => {
  it('is false during SSR, so the server never renders a section pre-opened', () => {
    expect(noSectionChoiceMade()).toBe(false);
  });

  it('is true when the key has never been written', () => {
    installStorage();
    expect(noSectionChoiceMade()).toBe(true);
  });

  it('is false once ANY section has been opened', () => {
    installStorage();
    setSectionExpanded('bubble:abc', true);
    expect(noSectionChoiceMade()).toBe(false);
  });

  it('is false after an open-then-close — an empty list is still a choice', () => {
    installStorage();
    setSectionExpanded('bubble:abc', true);
    setSectionExpanded('bubble:abc', false);
    expect(readExpandedSections().size).toBe(0);
    expect(noSectionChoiceMade()).toBe(false);
  });

  it('is false when storage throws — a private window cannot remember the auto-open', () => {
    installStorage();
    (globalThis as unknown as { window: { localStorage: { getItem: unknown } } }).window.localStorage.getItem =
      () => {
        throw new Error('SecurityError');
      };
    expect(noSectionChoiceMade()).toBe(false);
  });
});
