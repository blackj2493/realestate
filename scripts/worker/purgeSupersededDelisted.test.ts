/**
 * Wiring tests for the superseded-de-listed purge against a stub Typesense client:
 * the right filters go out, the right ids come back deleted, and every failure mode
 * degrades to "change nothing" rather than dropping docs.
 */
import { describe, it, expect } from 'vitest';
import type { Client } from 'typesense';
import type { SoldListingDocument } from '../../src/lib/typesense/soldListingsSchema';
import {
  detectSupersededForCloses,
  distinctAddresses,
  partitionSupersededDelisted,
  purgeSupersededForCloses,
  sweepSupersededDelisted,
} from './purgeSupersededDelisted';

const at = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const CHARLTON = '210 Charlton Avenue E, Hamilton, ON L8N 1Z1';

/** Minimal SoldListingDocument — only the fields this module reads matter. */
function doc(over: Partial<SoldListingDocument> & { id: string }): SoldListingDocument {
  return {
    ClosePrice: 0,
    ListPrice: 0,
    City: 'Hamilton',
    CityRegion: '',
    PropertySubType: 'Detached',
    BedroomsTotal: 2,
    BathroomsTotalInteger: 1,
    BuildingAreaTotal: 0,
    ParkingTotal: 2,
    LotWidth: 0,
    BasementTier: 0,
    PurchaseContractDate: at('2026-01-01'),
    ...over,
  } as SoldListingDocument;
}

const TERMINATED = doc({
  id: 'X12833514',
  DealType: 'terminated',
  UnparsedAddress: CHARLTON,
  PurchaseContractDate: at('2026-06-01'),
});
const SOLD = doc({
  id: 'X13220658',
  DealType: 'sold',
  UnparsedAddress: CHARLTON,
  PurchaseContractDate: at('2026-07-02'),
});

interface Recorded {
  searchFilters: string[];
  deleteFilters: string[];
  exportFilters: string[];
}

/** Stub client that answers searches/exports from a fixed doc set. */
function stubClient(
  docs: SoldListingDocument[],
  opts: { failSearch?: boolean; failDelete?: boolean } = {}
): { client: Client; recorded: Recorded } {
  const recorded: Recorded = { searchFilters: [], deleteFilters: [], exportFilters: [] };
  const matching = (filter: string) => {
    // Good enough for the stub: parse the DealType list and the address list.
    const kinds = /DealType:=\[([^\]]+)\]/.exec(filter)?.[1].split(',') ?? [];
    const addrs = /UnparsedAddress:=\[([^\]]+)\]/
      .exec(filter)?.[1]
      .split('`,`')
      .map((a) => a.replace(/`/g, '').toLowerCase());
    return docs.filter(
      (d) =>
        kinds.includes(String(d.DealType)) &&
        (!addrs || addrs.includes((d.UnparsedAddress ?? '').toLowerCase()))
    );
  };
  const documents = () => ({
    search: async ({ filter_by }: any) => {
      if (opts.failSearch) throw new Error('typesense down');
      recorded.searchFilters.push(filter_by);
      const hits = matching(filter_by).map((document) => ({ document }));
      return { found: hits.length, hits };
    },
    export: async ({ filter_by }: any) => {
      recorded.exportFilters.push(filter_by);
      return matching(filter_by)
        .map((d) => JSON.stringify(d))
        .join('\n');
    },
    delete: async ({ filter_by }: any) => {
      if (opts.failDelete) throw new Error('delete refused');
      recorded.deleteFilters.push(filter_by);
      const ids = /id:=\[([^\]]+)\]/.exec(filter_by)?.[1].split(',') ?? [];
      return { num_deleted: ids.length };
    },
  });
  return { client: { collections: () => ({ documents }) } as unknown as Client, recorded };
}

describe('distinctAddresses', () => {
  it('de-duplicates and drops blanks, preserving the feed casing verbatim', () => {
    expect(
      distinctAddresses([
        { UnparsedAddress: CHARLTON },
        { UnparsedAddress: CHARLTON },
        { UnparsedAddress: '  ' },
        {},
        { UnparsedAddress: ' 1 Other St ' },
      ])
    ).toEqual([CHARLTON, '1 Other St']);
  });
});

describe('detectSupersededForCloses', () => {
  it('finds the de-listed original invalidated by a close in the batch', async () => {
    const { client, recorded } = stubClient([TERMINATED, SOLD]);
    const matches = await detectSupersededForCloses(client, [SOLD]);
    expect(matches.map((m) => m.delistedId)).toEqual(['X12833514']);
    expect(recorded.searchFilters[0]).toContain('DealType:=[terminated,expired,suspended]');
    expect(recorded.searchFilters[0]).toContain(`\`${CHARLTON}\``);
  });

  it('does not query at all for a batch containing only de-listed docs', async () => {
    const { client, recorded } = stubClient([TERMINATED, SOLD]);
    expect(await detectSupersededForCloses(client, [TERMINATED])).toEqual([]);
    expect(recorded.searchFilters).toEqual([]);
  });

  it('ignores closes with no address to join on', async () => {
    const { client, recorded } = stubClient([TERMINATED]);
    const addressless = doc({ id: 'X1', DealType: 'sold', PurchaseContractDate: at('2026-07-02') });
    expect(await detectSupersededForCloses(client, [addressless])).toEqual([]);
    expect(recorded.searchFilters).toEqual([]);
  });
});

describe('purgeSupersededForCloses', () => {
  it('deletes exactly the superseded de-listed ids', async () => {
    const { client, recorded } = stubClient([TERMINATED, SOLD]);
    expect(await purgeSupersededForCloses(client, [SOLD])).toBe(1);
    expect(recorded.deleteFilters).toEqual(['id:=[X12833514]']);
  });

  it('never deletes the close itself', async () => {
    const { client, recorded } = stubClient([TERMINATED, SOLD]);
    await purgeSupersededForCloses(client, [SOLD]);
    expect(recorded.deleteFilters.join()).not.toContain('X13220658');
  });

  it('does not purge for a LEASE close — those pins stay lit by design', async () => {
    const leaseClose = doc({
      id: 'X99',
      DealType: 'leased',
      UnparsedAddress: CHARLTON,
      PurchaseContractDate: at('2026-07-02'),
    });
    const { client, recorded } = stubClient([TERMINATED, leaseClose]);
    expect(await purgeSupersededForCloses(client, [leaseClose])).toBe(0);
    expect(recorded.searchFilters).toEqual([]);
    expect(recorded.deleteFilters).toEqual([]);
  });

  it('leaves a de-list that postdates the close alone', async () => {
    const later = { ...TERMINATED, PurchaseContractDate: at('2026-07-20') };
    const { client, recorded } = stubClient([later, SOLD]);
    expect(await purgeSupersededForCloses(client, [SOLD])).toBe(0);
    expect(recorded.deleteFilters).toEqual([]);
  });

  it('swallows a Typesense failure and deletes nothing', async () => {
    const { client, recorded } = stubClient([TERMINATED, SOLD], { failSearch: true });
    expect(await purgeSupersededForCloses(client, [SOLD])).toBe(0);
    expect(recorded.deleteFilters).toEqual([]);
  });

  it('swallows a delete failure', async () => {
    const { client } = stubClient([TERMINATED, SOLD], { failDelete: true });
    expect(await purgeSupersededForCloses(client, [SOLD])).toBe(0);
  });
});

describe('partitionSupersededDelisted', () => {
  it('withholds a de-list whose property already closed', async () => {
    const { client } = stubClient([SOLD]);
    const { keep, superseded } = await partitionSupersededDelisted(client, [TERMINATED]);
    expect(keep).toEqual([]);
    expect(superseded.map((d) => d.id)).toEqual(['X12833514']);
  });

  it('keeps a de-list with no close at its address', async () => {
    const { client } = stubClient([]);
    const { keep, superseded } = await partitionSupersededDelisted(client, [TERMINATED]);
    expect(keep.map((d) => d.id)).toEqual(['X12833514']);
    expect(superseded).toEqual([]);
  });

  it('keeps everything when the lookup fails — never drops on error', async () => {
    const { client } = stubClient([SOLD], { failSearch: true });
    const { keep, superseded } = await partitionSupersededDelisted(client, [TERMINATED]);
    expect(keep.map((d) => d.id)).toEqual(['X12833514']);
    expect(superseded).toEqual([]);
  });

  it('splits a mixed batch', async () => {
    const safe = doc({
      id: 'KEEP',
      DealType: 'expired',
      UnparsedAddress: '9 Nowhere Rd, Hamilton, ON L8N 1Z1',
      PurchaseContractDate: at('2026-06-01'),
    });
    const { client } = stubClient([SOLD]);
    const { keep, superseded } = await partitionSupersededDelisted(client, [TERMINATED, safe]);
    expect(keep.map((d) => d.id)).toEqual(['KEEP']);
    expect(superseded.map((d) => d.id)).toEqual(['X12833514']);
  });
});

describe('sweepSupersededDelisted', () => {
  it('reports without deleting on a dry run', async () => {
    const { client, recorded } = stubClient([TERMINATED, SOLD]);
    const res = await sweepSupersededDelisted(client, { apply: false });
    expect(res.superseded).toBe(1);
    expect(res.deleted).toBe(0);
    expect(recorded.deleteFilters).toEqual([]);
  });

  it('deletes on --apply', async () => {
    const { client, recorded } = stubClient([TERMINATED, SOLD]);
    const res = await sweepSupersededDelisted(client, { apply: true });
    expect(res.deleted).toBe(1);
    expect(recorded.deleteFilters).toEqual(['id:=[X12833514]']);
  });

  it('honours --limit so a first production run can be bounded', async () => {
    const second = doc({
      id: 'W13575278',
      DealType: 'terminated',
      UnparsedAddress: '84 Hadrian Drive, Toronto, ON M9W 1V4',
      PurchaseContractDate: at('2026-07-29'),
    });
    const secondClose = doc({
      id: 'W13617774',
      DealType: 'sold',
      UnparsedAddress: '84 Hadrian Drive, Toronto, ON M9W 1V4',
      PurchaseContractDate: at('2026-07-31'),
    });
    const { client, recorded } = stubClient([TERMINATED, SOLD, second, secondClose]);
    const res = await sweepSupersededDelisted(client, { apply: true, limit: 1 });
    expect(res.superseded).toBe(1);
    expect(recorded.deleteFilters).toHaveLength(1);
  });
});
