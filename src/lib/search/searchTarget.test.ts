import { describe, it, expect } from 'vitest';
import type { SearchSuggestion } from '@/lib/typesense/client';
import {
  resolveSuggestionTarget,
  resolveTextTarget,
  targetToHref,
} from './searchTarget';

// Minimal ListingDocument stand-in — only `id` matters to these functions.
const listing = { id: 'W12632618' } as unknown as NonNullable<SearchSuggestion['listing']>;

describe('resolveSuggestionTarget', () => {
  it('opens the listing for an address suggestion that carries a listing', () => {
    const s: SearchSuggestion = { kind: 'address', label: '40 Rampart Dr', listing };
    expect(resolveSuggestionTarget(s)).toEqual({ action: 'open-listing', listing });
  });

  it('opens the listing for an MLS suggestion', () => {
    const s: SearchSuggestion = { kind: 'mls', label: 'W12632618', listing };
    expect(resolveSuggestionTarget(s)).toEqual({ action: 'open-listing', listing });
  });

  it('sets location for a city suggestion', () => {
    const s: SearchSuggestion = { kind: 'city', label: 'Hamilton', count: 1200 };
    expect(resolveSuggestionTarget(s)).toEqual({ action: 'set-location', label: 'Hamilton' });
  });

  it('sets location for a neighbourhood suggestion', () => {
    const s: SearchSuggestion = { kind: 'neighbourhood', label: 'Vales of Castlemore' };
    expect(resolveSuggestionTarget(s)).toEqual({
      action: 'set-location',
      label: 'Vales of Castlemore',
    });
  });

  it('falls back to location when an address suggestion has no listing', () => {
    const s: SearchSuggestion = { kind: 'address', label: '40 Rampart Dr' };
    expect(resolveSuggestionTarget(s)).toEqual({ action: 'set-location', label: '40 Rampart Dr' });
  });

  it('trims the location label', () => {
    const s: SearchSuggestion = { kind: 'city', label: '  Hamilton  ' };
    expect(resolveSuggestionTarget(s)).toEqual({ action: 'set-location', label: 'Hamilton' });
  });
});

describe('resolveTextTarget', () => {
  it('treats free-typed text as a location search and trims it', () => {
    expect(resolveTextTarget('  Brampton ')).toEqual({ action: 'set-location', label: 'Brampton' });
  });
});

describe('targetToHref', () => {
  it('routes a listing target to the detail page by id', () => {
    expect(targetToHref({ action: 'open-listing', listing })).toBe('/properties/W12632618');
  });

  it('routes a location target to /properties?city= with encoding', () => {
    expect(targetToHref({ action: 'set-location', label: 'St. Catharines' })).toBe(
      '/properties?city=St.%20Catharines',
    );
  });
});
