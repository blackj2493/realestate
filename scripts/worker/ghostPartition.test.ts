import { describe, it, expect } from 'vitest';
import { partitionGhosts } from './ghostPartition';

const feed = (entries: Array<[string, any]>) => new Map<string, any>(entries);

describe('partitionGhosts', () => {
  it('condemns a key the feed does not serve at all', () => {
    // E13415990 — a Commercial Retail lease the feed stopped serving on 2026-06-08
    // without ever sending a terminal record.
    const r = partitionGhosts(['E13415990'], feed([]));
    expect(r.dead).toEqual(['E13415990']);
    expect(r.alive).toEqual([]);
    expect(r.closed).toEqual([]);
    expect(r.statusTally).toEqual({ NOT_IN_FEED: 1 });
  });

  it('keeps a listing that is Active again', () => {
    const r = partitionGhosts(
      ['X1'],
      feed([['X1', { ListingKey: 'X1', StandardStatus: 'Active', MlsStatus: 'New' }]])
    );
    expect(r.dead).toEqual([]);
    expect(r.alive).toEqual(['X1']);
    expect(r.keptActive).toBe(1);
  });

  it('keeps conditionals visible', () => {
    const r = partitionGhosts(
      ['X1', 'X2'],
      feed([
        ['X1', { StandardStatus: 'Active Under Contract', MlsStatus: 'Sold Conditional' }],
        ['X2', { StandardStatus: 'Active Under Contract', MlsStatus: 'Leased Conditional' }],
      ])
    );
    expect(r.keptActive).toBe(2);
    expect(r.dead).toEqual([]);
    expect(r.alive).toEqual(['X1', 'X2']);
  });

  it('routes a lease close to the repair path, not to dead', () => {
    const leased = { ListingKey: 'L1', StandardStatus: 'Closed', MlsStatus: 'Leased' };
    const r = partitionGhosts(['L1'], feed([['L1', leased]]));
    expect(r.closed).toEqual([leased]);
    expect(r.dead).toEqual([]);
  });

  it('routes a sale close the same way', () => {
    const sold = { ListingKey: 'S1', StandardStatus: 'Closed', MlsStatus: 'Sold' };
    const r = partitionGhosts(['S1'], feed([['S1', sold]]));
    expect(r.closed).toEqual([sold]);
  });

  it('never pardons a close', () => {
    // `alive` is the PARDON list — the caller clears the vault orphan flag on it. On the
    // vault-wide sweep no sold repair runs, so a pardoned close keeps its stale Active
    // payload and stays re-indexable as available every single week.
    const r = partitionGhosts(
      ['L1', 'S1'],
      feed([
        ['L1', { ListingKey: 'L1', StandardStatus: 'Closed', MlsStatus: 'Leased' }],
        ['S1', { ListingKey: 'S1', StandardStatus: 'Closed', MlsStatus: 'Sold' }],
      ])
    );
    expect(r.alive).toEqual([]);
    expect(r.keptActive).toBe(0);
    expect(r.closed).toHaveLength(2);
  });

  it('condemns Cancelled/Withdrawn/Expired and does NOT call them alive', () => {
    // Load-bearing: the caller clears the orphan flag on everything in `alive`. A key
    // in both lists gets flagged and then pardoned in the same run, and the reindex
    // resurrects it — the vault payload for these is still frozen reading Active.
    const r = partitionGhosts(
      ['C1', 'W1', 'E1', 'D1'],
      feed([
        ['C1', { StandardStatus: 'Cancelled', MlsStatus: 'Terminated' }],
        ['W1', { StandardStatus: 'Withdrawn', MlsStatus: 'Suspended' }],
        ['E1', { StandardStatus: 'Expired', MlsStatus: 'Expired' }],
        ['D1', { StandardStatus: 'Delete', MlsStatus: 'Deleted' }],
      ])
    );
    expect(r.dead).toEqual(['C1', 'W1', 'E1', 'D1']);
    expect(r.alive).toEqual([]);
    expect(r.keptActive).toBe(0);
  });

  it('accounts for every candidate exactly once, and never in two buckets', () => {
    const r = partitionGhosts(
      ['A', 'B', 'C', 'D', 'E'],
      feed([
        ['A', { StandardStatus: 'Active', MlsStatus: 'New' }],
        ['B', { ListingKey: 'B', StandardStatus: 'Closed', MlsStatus: 'Leased' }],
        ['C', { StandardStatus: 'Cancelled', MlsStatus: 'Terminated' }],
        // D is absent from the feed.
        ['E', { StandardStatus: 'Active Under Contract', MlsStatus: 'Sold Conditional' }],
      ])
    );
    const closedKeys = r.closed.map((x: { ListingKey: string }) => x.ListingKey);
    expect(r.dead.filter((k) => r.alive.includes(k))).toEqual([]);
    expect(r.dead.filter((k) => closedKeys.includes(k))).toEqual([]);
    expect(r.alive.filter((k) => closedKeys.includes(k))).toEqual([]);
    expect([...r.dead, ...r.alive, ...closedKeys].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('tallies every candidate for the run log', () => {
    const r = partitionGhosts(
      ['A', 'B', 'C'],
      feed([
        ['A', { StandardStatus: 'Closed', MlsStatus: 'Leased' }],
        ['B', { StandardStatus: 'Closed', MlsStatus: 'Leased' }],
      ])
    );
    expect(r.statusTally).toEqual({ 'Closed/Leased': 2, NOT_IN_FEED: 1 });
  });
});
