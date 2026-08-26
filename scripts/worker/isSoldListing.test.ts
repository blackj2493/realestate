import { describe, it, expect, vi } from 'vitest';

// isSoldListing is a pure status predicate, but it lives in ingester.ts — and half a
// dozen modules in that import graph call createClient() at module scope, which throws
// on a missing URL. Feed those a placeholder rather than mocking each offender in turn:
// nothing here makes a network call, and a new import-time client added upstream should
// not break this test. vi.hoisted runs before the imports below.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
});

import { isSoldListing } from './ingester';

describe('isSoldListing — lease closes', () => {
  it('files a normal lease close as closed (StandardStatus carries it)', () => {
    expect(isSoldListing({ StandardStatus: 'Closed', MlsStatus: 'Leased' })).toBe(true);
  });

  it('files a lease close from MlsStatus alone when StandardStatus is missing', () => {
    // The predicate ORs the two fields. Before 'leased' was listed, this record fell
    // through to the safe default and was filed as still-available.
    expect(isSoldListing({ MlsStatus: 'Leased' })).toBe(true);
    expect(isSoldListing({ StandardStatus: '', MlsStatus: 'Leased' })).toBe(true);
  });

  it('leaves lease conditionals alone — they stay visible by product policy', () => {
    expect(
      isSoldListing({ StandardStatus: 'Active Under Contract', MlsStatus: 'Leased Conditional' })
    ).toBe(false);
    expect(
      isSoldListing({
        StandardStatus: 'Active Under Contract',
        MlsStatus: 'Leased Conditional Escape',
      })
    ).toBe(false);
  });

  it('still files sale closes and leaves actives alone', () => {
    expect(isSoldListing({ StandardStatus: 'Closed', MlsStatus: 'Sold' })).toBe(true);
    expect(isSoldListing({ StandardStatus: 'Active', MlsStatus: 'New' })).toBe(false);
    expect(isSoldListing({ StandardStatus: 'Active', MlsStatus: 'Price Change' })).toBe(false);
    expect(isSoldListing({ StandardStatus: 'Active', MlsStatus: 'Extension' })).toBe(false);
  });

  it('treats an unrecognized status as not sold', () => {
    expect(isSoldListing({ StandardStatus: 'Wibble', MlsStatus: 'Wobble' })).toBe(false);
    expect(isSoldListing({})).toBe(false);
  });
});
