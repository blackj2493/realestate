import { describe, expect, it } from 'vitest';
import { deriveWatchAlerts, normalizeSeen } from './watchAlerts';
import type { WatchlistChange } from './useWatchlistSnapshot';

/** Minimal WatchlistChange builder — only the fields the derivation reads. */
function change(over: {
  key: string;
  address?: string;
  city?: string;
  list_price?: number;
  currentPrice?: number;
  currentAddress?: string;
  offMarket?: boolean;
  disposition?: WatchlistChange['disposition'];
}): WatchlistChange {
  const current =
    over.currentPrice != null
      ? ({ ListPrice: over.currentPrice, UnparsedAddress: over.currentAddress } as WatchlistChange['current'])
      : undefined;
  return {
    item: {
      listing_key: over.key,
      address: over.address,
      city: over.city,
      list_price: over.list_price,
    },
    current,
    offMarket: over.offMarket ?? false,
    disposition: over.disposition,
    isStale: false,
  };
}

describe('deriveWatchAlerts — price drops', () => {
  it('emits a drop with pct, price signature and live address', () => {
    const [a] = deriveWatchAlerts([
      change({ key: 'W1234567', address: 'saved addr', list_price: 1_000_000, currentPrice: 900_000, currentAddress: '12 Main St' }),
    ]);
    expect(a).toMatchObject({
      id: 'W1234567',
      href: '/properties/W1234567',
      address: '12 Main St',
      kind: 'drop',
      sig: 'p:900000',
      oldPrice: 1_000_000,
      newPrice: 900_000,
      dropPct: 10,
    });
  });

  it('ignores unchanged, raised and baseline-less listings', () => {
    expect(
      deriveWatchAlerts([
        change({ key: 'W1', list_price: 500_000, currentPrice: 500_000 }),
        change({ key: 'W2', list_price: 500_000, currentPrice: 550_000 }),
        change({ key: 'W3', currentPrice: 450_000 }), // no saved baseline
      ])
    ).toHaveLength(0);
  });
});

describe('deriveWatchAlerts — dispositions', () => {
  it('links a relist to the NEW key, with new-key signature and IDX ask', () => {
    const [a] = deriveWatchAlerts([
      change({
        key: 'W1111111',
        address: 'old addr',
        offMarket: true,
        disposition: { kind: 'relisted', newKey: 'W2222222', newPrice: 899_000, newAddress: '9 Elm Ave' },
      }),
    ]);
    expect(a).toMatchObject({
      id: 'W1111111',
      href: '/properties/W2222222',
      address: '9 Elm Ave',
      kind: 'relisted',
      sig: 's:relisted:W2222222',
      relistPrice: 899_000,
    });
  });

  it('maps sold / leased / unresolved to their kinds (unresolved = generic off)', () => {
    const alerts = deriveWatchAlerts([
      change({ key: 'S1', address: 'a', offMarket: true, disposition: { kind: 'sold' } }),
      change({ key: 'L1', address: 'b', offMarket: true, disposition: { kind: 'leased' } }),
      change({ key: 'O1', address: 'c', offMarket: true, disposition: { kind: 'off-market', reason: 'gone' } }),
      change({ key: 'U1', address: 'd', offMarket: true }), // disposition fetch in flight
    ]);
    expect(alerts.map((a) => [a.id, a.kind, a.sig])).toEqual([
      ['S1', 'sold', 's:sold'],
      ['L1', 'leased', 's:leased'],
      ['O1', 'off', 's:off'],
      ['U1', 'off', 's:off'],
    ]);
  });

  it('an off-market home resolving to sold changes the signature (re-lights the bell)', () => {
    const unresolved = deriveWatchAlerts([change({ key: 'X1', offMarket: true })])[0];
    const resolved = deriveWatchAlerts([
      change({ key: 'X1', offMarket: true, disposition: { kind: 'sold' } }),
    ])[0];
    expect(unresolved.sig).not.toBe(resolved.sig);
  });
});

describe('deriveWatchAlerts — ordering', () => {
  it('sorts actionable first: drops (deepest cut first), relists, then closures', () => {
    const alerts = deriveWatchAlerts([
      change({ key: 'S1', offMarket: true, disposition: { kind: 'sold' } }),
      change({ key: 'D5', list_price: 1_000_000, currentPrice: 950_000 }), // -5%
      change({ key: 'R1', offMarket: true, disposition: { kind: 'relisted', newKey: 'R2', newPrice: null, newAddress: null } }),
      change({ key: 'D10', list_price: 1_000_000, currentPrice: 900_000 }), // -10%
      change({ key: 'O1', offMarket: true }),
    ]);
    expect(alerts.map((a) => a.id)).toEqual(['D10', 'D5', 'R1', 'S1', 'O1']);
  });
});

describe('normalizeSeen', () => {
  it('coerces the legacy price-number format and keeps signatures', () => {
    expect(
      normalizeSeen({ W1: 900_000, W2: 's:sold', W3: null, W4: { junk: true } })
    ).toEqual({ W1: 'p:900000', W2: 's:sold' });
  });

  it('returns empty on junk payloads', () => {
    expect(normalizeSeen(null)).toEqual({});
    expect(normalizeSeen('str')).toEqual({});
    expect(normalizeSeen([1, 2])).toEqual({});
  });
});
