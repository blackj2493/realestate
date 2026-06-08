import { ProptXClient } from '@/lib/proptx/client';
import { unitsMatchForMerge } from '@/lib/typesense/TemporalDistressEngine';
import { normalizeCampaigns, type RawVowCampaign } from './normalize';
import type { CampaignEvent } from './types';
import type { PropertySearchParams } from '@/lib/proptx/types';

/** Address + subtype the fetch/unit-filter needs. */
export interface SubjectAddress {
  StreetNumber?: unknown;
  StreetName?: unknown;
  City?: unknown;
  UnitNumber?: unknown;
  PropertySubType?: unknown;
}

const CAMPAIGN_SELECT = [
  'ListingKey', 'StandardStatus', 'MlsStatus', 'TransactionType', 'PropertySubType',
  'OriginalEntryTimestamp', 'ListPrice', 'OriginalListPrice', 'ClosePrice',
  'PurchaseContractDate', 'CloseDate', 'TerminatedDate', 'ExpirationDate',
  'SuspendedDate', 'UnavailableDate', 'PriorMlsStatus', 'PriceChangeTimestamp',
  'MajorChangeTimestamp', 'ListOfficeName', 'StreetNumber', 'StreetName', 'City',
  'UnitNumber', 'UnparsedAddress',
].join(',');

const PAGE_SIZE = 100;
const MAX_PAGES = 3; // cap: 300 campaigns at one address is already pathological
const DEFAULT_TIMEOUT_MS = 8000;

/** Page-continuation predicate: keep going only on a full page under the page cap. */
export function shouldFetchMore(
  lastPageLength: number,
  pagesFetched: number,
  opts: { pageSize?: number; maxPages?: number } = {}
): boolean {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  return lastPageLength === pageSize && pagesFetched < maxPages;
}

/** Reject a promise after `ms` so a slow feed call never hangs the caller. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(handle)),
    new Promise<T>((_, reject) => {
      handle = setTimeout(() => reject(new Error('campaign fetch timeout')), ms);
    }),
  ]);
}

function odataEscape(v: string): string {
  return v.replace(/'/g, "''");
}

/** OData $filter to pull every campaign at a physical address. null when unusable. */
export function buildCampaignFilter(addr: SubjectAddress): string | null {
  const num = String(addr.StreetNumber ?? '').trim();
  const name = String(addr.StreetName ?? '').trim();
  const city = String(addr.City ?? '').trim();
  if (!num || !name) return null;
  const parts = [
    `StreetNumber eq '${odataEscape(num)}'`,
    `StreetName eq '${odataEscape(name)}'`,
  ];
  if (city) parts.push(`City eq '${odataEscape(city)}'`);
  return parts.join(' and ');
}

/** A building query returns all units; keep only the subject's unit (Phase-2 guards). */
export function filterEventsToSubjectUnit(
  rows: RawVowCampaign[],
  subject: SubjectAddress
): RawVowCampaign[] {
  return rows.filter((r) =>
    unitsMatchForMerge(
      { UnitNumber: subject.UnitNumber, PropertySubType: subject.PropertySubType },
      { UnitNumber: r.UnitNumber, PropertySubType: r.PropertySubType }
    )
  );
}

/**
 * Fetch + normalize every campaign at the subject's address from the VOW feed.
 * Pages via $skip up to MAX_PAGES, each call timeout-guarded. Best-effort: returns
 * [] on a missing filter, and returns whatever pages succeeded if a later page
 * errors/times out (the caller decides how to treat a partial/empty result).
 */
export async function fetchCampaignsByAddress(
  addr: SubjectAddress,
  vowToken: string,
  opts: { timeoutMs?: number; maxPages?: number } = {}
): Promise<CampaignEvent[]> {
  const filter = buildCampaignFilter(addr);
  if (!filter) return [];
  const client = new ProptXClient(vowToken, 'VOW');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  const rows: RawVowCampaign[] = [];
  let skip = 0;
  let pages = 0;
  let lastLen = 0;
  do {
    let page: RawVowCampaign[];
    try {
      const res = await withTimeout(
        client.getProperties({
          $filter: filter,
          $select: CAMPAIGN_SELECT,
          $top: PAGE_SIZE,
          $skip: skip,
          $count: false,
        } as PropertySearchParams),
        timeoutMs
      );
      page = ((res?.value ?? []) as unknown[]) as RawVowCampaign[];
    } catch (err) {
      console.warn(`[campaignHistory] fetch page ${pages + 1} failed (best-effort):`, (err as Error)?.message ?? err);
      break; // keep the pages we already have
    }
    rows.push(...page);
    lastLen = page.length;
    pages += 1;
    skip += PAGE_SIZE;
  } while (shouldFetchMore(lastLen, pages, { maxPages }));

  return normalizeCampaigns(filterEventsToSubjectUnit(rows, addr));
}
