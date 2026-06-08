import { ProptXClient } from '@/lib/proptx/client';
import { unitsMatchForMerge } from '@/lib/typesense/TemporalDistressEngine';
import { normalizeCampaigns, type RawVowCampaign } from './normalize';
import type { CampaignEvent } from './types';

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
 * Best-effort: returns [] on a missing filter; the caller wraps network errors.
 */
export async function fetchCampaignsByAddress(
  addr: SubjectAddress,
  vowToken: string
): Promise<CampaignEvent[]> {
  const filter = buildCampaignFilter(addr);
  if (!filter) return [];
  const client = new ProptXClient(vowToken, 'VOW');
  const res = await client.getProperties({
    $filter: filter,
    $select: CAMPAIGN_SELECT,
    $top: 100,
    $count: true,
  });
  const rows = ((res?.value ?? []) as unknown[]) as RawVowCampaign[];
  return normalizeCampaigns(filterEventsToSubjectUnit(rows, addr));
}
