import { describe, it, expect } from 'vitest';
import type { SearchSuggestion } from '@/lib/typesense/client';
import {
  resolveSuggestionTarget,
  resolveTextTarget,
  targetToHref,
  addressProfileHref,
  soldAddressHref,
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

  // The header bar used to flatten a record into a listing-less address row, which fell
  // into the branch above and re-derived an UNKEYED profile URL — so the same click went
  // to a different page than it did in the terminal. A record's href is authoritative.
  it('uses the record href verbatim, including a forward to the live relist', () => {
    const s: SearchSuggestion = {
      kind: 'record',
      label: '90 Osler Drive, Hamilton, ON L9H 4B5',
      record: {
        key: 'X12888728',
        address: '90 Osler Drive, Hamilton, ON L9H 4B5',
        city: 'Hamilton',
        dealKind: 'offmarket',
        href: '/properties/X13585448',
        liveKey: 'X13585448',
      },
    };
    const t = resolveSuggestionTarget(s);
    expect(t).toEqual({
      action: 'open-href',
      href: '/properties/X13585448',
      label: '90 Osler Drive, Hamilton, ON L9H 4B5',
    });
    expect(targetToHref(t)).toBe('/properties/X13585448');
  });

  it('keeps a record on its own keyed page when nothing is live at the address', () => {
    const s: SearchSuggestion = {
      kind: 'record',
      label: '12 Nowhere Lane, Hamilton, ON',
      record: {
        key: 'X999',
        address: '12 Nowhere Lane, Hamilton, ON',
        city: 'Hamilton',
        dealKind: 'sold',
        href: '/address/on/hamilton/12-nowhere-lane-X999',
      },
    };
    expect(targetToHref(resolveSuggestionTarget(s))).toBe('/address/on/hamilton/12-nowhere-lane-X999');
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

  it('diverts an address-shaped location target to the address-profile route', () => {
    expect(targetToHref({ action: 'set-location', label: '142 Maplewood Ave, Hamilton' })).toBe(
      '/address/on/hamilton/142-maplewood-ave',
    );
  });
});

describe('addressProfileHref (ADDRESS_PROFILES_PLAN P4)', () => {
  it('routes an address with a city', () => {
    expect(addressProfileHref('142 Maplewood Ave, Hamilton')).toBe('/address/on/hamilton/142-maplewood-ave');
  });

  it('routes a city-less address under the ontario segment', () => {
    expect(addressProfileHref('10 King St')).toBe('/address/on/ontario/10-king-st');
  });

  it('strips a postal code from the city segment', () => {
    expect(addressProfileHref('142 Maplewood Ave, Hamilton L8M 2C7')).toBe(
      '/address/on/hamilton/142-maplewood-ave',
    );
  });

  it('returns null for a plain place (no civic number)', () => {
    expect(addressProfileHref('Toronto')).toBeNull();
    expect(addressProfileHref('Richmond Hill')).toBeNull();
  });

  it('returns null for a bare number', () => {
    expect(addressProfileHref('142')).toBeNull();
  });
});

describe("soldAddressHref", () => {
  it("builds the canonical keyed /address URL (sitemap shape)", () => {
    expect(soldAddressHref("127 Via Toscana N/A, Vaughan, ON L4H 3C1", "Vaughan", "N13485582")).toBe(
      "/address/on/vaughan/127-via-toscana-n-a-N13485582"
    );
  });

  it("falls back to ontario when the city is empty", () => {
    expect(soldAddressHref("10 King St", "", "X1")).toBe("/address/on/ontario/10-king-st-X1");
  });
});
