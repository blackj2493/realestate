import { describe, it, expect } from 'vitest';
import {
  collectStaleSearchDocIds,
  buildIdDeleteFilters,
  NON_ACTIVE_STATUSES,
} from './staleSearchDocs';

describe('collectStaleSearchDocIds', () => {
  it('returns every doc id for a sold (Query B) batch — their stale Active docs must be deleted', () => {
    const docs = [
      { id: 'W13164912', Status: 'Sold' },
      { id: 'C12731122', Status: 'Closed' },
    ];
    expect(collectStaleSearchDocIds(docs, { isSold: true })).toEqual([
      'W13164912',
      'C12731122',
    ]);
  });

  it('returns only terminal-status ids in an active batch, case-insensitive and trimmed', () => {
    const docs = [
      { id: 'A1', Status: 'New' },
      { id: 'A2', Status: ' Terminated ' },
      { id: 'A3', Status: 'EXPIRED' },
      { id: 'A4', Status: 'Price Change' },
      { id: 'A5', Status: 'Leased' },
    ];
    expect(collectStaleSearchDocIds(docs)).toEqual(['A2', 'A3', 'A5']);
  });

  it('keeps Sold Conditional listings in the index (still conditionally available)', () => {
    const docs = [{ id: 'A1', Status: 'Sold Conditional' }];
    expect(collectStaleSearchDocIds(docs)).toEqual([]);
  });

  it('drops docs with missing/empty ids and dedupes', () => {
    const docs = [
      { id: 'K1', Status: 'Sold' },
      { id: 'K1', Status: 'Sold' },
      { id: '', Status: 'Sold' },
      { Status: 'Sold' },
      { id: null, Status: 'Sold' },
    ];
    expect(collectStaleSearchDocIds(docs, { isSold: true })).toEqual(['K1']);
  });

  it('returns [] for an active batch with only available statuses', () => {
    const docs = [
      { id: 'A1', Status: 'New' },
      { id: 'A2', Status: 'Extension' },
    ];
    expect(collectStaleSearchDocIds(docs)).toEqual([]);
  });
});

describe('buildIdDeleteFilters', () => {
  it('formats ids into a Typesense id:=[...] delete filter', () => {
    expect(buildIdDeleteFilters(['K1', 'K2'])).toEqual(['id:=[K1,K2]']);
  });

  it('chunks long key lists to keep filter strings bounded', () => {
    const ids = Array.from({ length: 5 }, (_, i) => `K${i}`);
    expect(buildIdDeleteFilters(ids, 2)).toEqual([
      'id:=[K0,K1]',
      'id:=[K2,K3]',
      'id:=[K4]',
    ]);
  });

  it('returns [] for no ids', () => {
    expect(buildIdDeleteFilters([])).toEqual([]);
  });
});

describe('NON_ACTIVE_STATUSES', () => {
  it('matches the terminal statuses the sync previously skip-filtered', () => {
    for (const s of ['sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended']) {
      expect(NON_ACTIVE_STATUSES.has(s)).toBe(true);
    }
    expect(NON_ACTIVE_STATUSES.has('sold conditional')).toBe(false);
  });
});
