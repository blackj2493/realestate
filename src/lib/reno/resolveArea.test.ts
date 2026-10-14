import { describe, it, expect } from 'vitest';
import { matchCohort, rankVotes, cityKey, sameCity } from './resolveArea';
import type { CohortTree } from '@/lib/avm/cohorts';

// Taxonomy only — the real tree has Middlefield but no Cedarwood cohort.
const TREE = {
  Markham: [{ cityRegion: 'Middlefield', types: ['Detached'] }],
  Mississauga: [{ cityRegion: 'Streetsville', types: ['Detached'] }],
} as unknown as CohortTree;

describe('rankVotes', () => {
  it('returns every community, best first, so an untrained winner can be skipped', () => {
    const ranked = rankVotes(
      [{ cr: 'Middlefield', city: 'Markham' }],
      ['Cedarwood', 'Cedarwood', 'Middlefield'],
    );
    expect(ranked.map((r) => r.cityRegion)).toEqual(['Cedarwood', 'Middlefield']);
    // The 73 Elvira Cres case: the top vote has no cohort, the second one does.
    const first = ranked.map((r) => matchCohort(TREE, r.city ?? undefined, r.cityRegion)).find(Boolean);
    expect(first).toEqual({ city: 'Markham', cityRegion: 'Middlefield' });
  });

  it('is empty with no votes', () => {
    expect(rankVotes([], [])).toEqual([]);
  });
});

describe('cityKey / sameCity', () => {
  it('drops the TRREB district code from Toronto', () => {
    expect(cityKey('Toronto C08')).toBe('toronto');
    expect(cityKey('Markham')).toBe('markham');
  });

  it('rejects a same-street record in another city', () => {
    expect(sameCity('Mississauga', 'markham')).toBe(false);
    expect(sameCity('Puslinch', 'toronto')).toBe(false);
  });

  it('accepts the same city, with or without a district code', () => {
    expect(sameCity('Markham', 'markham')).toBe(true);
    expect(sameCity('Toronto E08', 'Toronto')).toBe(true);
  });

  it('never matches on a missing city', () => {
    expect(sameCity('Markham', '')).toBe(false);
    expect(sameCity(null, 'markham')).toBe(false);
  });
});
