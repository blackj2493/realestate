import { describe, it, expect } from 'vitest';
import { nextSyncCursor } from './syncCursor';

const PREV = '2026-05-26T03:00:00.000Z';
const NOW = '2026-05-27T03:00:00.000Z';

describe('nextSyncCursor — success path', () => {
  it('advances the cursor to now when the sync completed', () => {
    expect(nextSyncCursor('completed', PREV, NOW)).toBe(NOW);
  });

  it('still advances on success even if the previous cursor is null (first run)', () => {
    expect(nextSyncCursor('completed', null, NOW)).toBe(NOW);
  });
});

describe('nextSyncCursor — failure path (the recovery contract)', () => {
  it('PRESERVES the previous cursor on failure — this is the §12 guard', () => {
    // The whole point of this module: a failed sync must NOT advance the
    // cursor, because doing so creates an unrecoverable gap in the window
    // covered by daily syncs. Re-attempting the same window is the only
    // safe recovery path.
    expect(nextSyncCursor('failed', PREV, NOW)).toBe(PREV);
  });

  it('falls back to now ONLY when the previous cursor is null/unknown', () => {
    // If readSyncState() itself threw, we don't have a previous cursor. In
    // that case we have no choice — writing `now` is no worse than the
    // alternative (the state was already unreadable). This branch exists
    // strictly so the helper never returns null.
    expect(nextSyncCursor('failed', null, NOW)).toBe(NOW);
  });
});

describe('nextSyncCursor — pure function properties', () => {
  it('returns one of the two inputs verbatim — no transformation', () => {
    // Asserting purity: the returned string is byte-identical to either
    // previousCursor or nowIso. A future change that "normalizes" the
    // output (e.g. round-trips through new Date()) would break this and
    // could subtly drift the cursor.
    const result1 = nextSyncCursor('completed', PREV, NOW);
    const result2 = nextSyncCursor('failed', PREV, NOW);
    expect(result1).toBe(NOW);
    expect(result2).toBe(PREV);
    // String identity (not just equality) — same reference for the success
    // case proves no copy/transformation.
    expect(result1 === NOW).toBe(true);
    expect(result2 === PREV).toBe(true);
  });
});
