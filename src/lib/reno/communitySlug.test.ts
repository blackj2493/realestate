import { describe, it, expect } from 'vitest';
import { slugifyCommunity, deslugifyCommunity, resolveCommunitySlug } from './communitySlug';
import type { CohortTree } from '@/lib/avm/cohorts';

describe('communitySlug', () => {
  it('slugifies a normalized community name', () => {
    expect(slugifyCommunity('Churchill Meadows')).toBe('churchill-meadows');
  });

  it('strips legacy numeric/area prefixes before slugifying', () => {
    expect(slugifyCommunity('1001 - BR Bronte')).toBe('bronte');
  });

  it('deslugifies to a title-cased display label', () => {
    expect(deslugifyCommunity('churchill-meadows')).toBe('Churchill Meadows');
  });

  it('round-trips slugify → deslugify for simple names', () => {
    expect(deslugifyCommunity(slugifyCommunity('Erin Mills'))).toBe('Erin Mills');
  });

  it('resolves a slug back to the RAW cityRegion + city via the tree', () => {
    const tree: CohortTree = {
      Mississauga: [
        { community: 'Churchill Meadows', cityRegion: '0140 - Churchill Meadows', types: ['Detached'] },
        { community: 'Erin Mills', cityRegion: 'Erin Mills', types: ['Condo'] },
      ],
    };
    expect(resolveCommunitySlug(tree, 'churchill-meadows')).toEqual({
      city: 'Mississauga',
      cityRegion: '0140 - Churchill Meadows',
    });
  });

  it('returns null for an unknown slug', () => {
    expect(resolveCommunitySlug({}, 'nowhere')).toBeNull();
  });
});
