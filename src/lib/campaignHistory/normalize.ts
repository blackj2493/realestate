import type { CampaignEvent, CampaignStatus, TransactionKind } from './types';

/** Subset of VOW /Property fields the campaign ledger consumes. */
export interface RawVowCampaign {
  ListingKey?: string;
  StandardStatus?: string;
  MlsStatus?: string;
  TransactionType?: string;
  PropertySubType?: string;
  OriginalEntryTimestamp?: string;
  ListPrice?: number | string;
  OriginalListPrice?: number | string;
  ClosePrice?: number | string;
  PurchaseContractDate?: string;
  CloseDate?: string;
  TerminatedDate?: string;
  ExpirationDate?: string;
  SuspendedDate?: string;
  UnavailableDate?: string;
  PriceChangeTimestamp?: string;
  ListOfficeName?: string;
  UnitNumber?: string;
  UnparsedAddress?: string;
  [k: string]: unknown;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
function strOrNull(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim();
  return s ? s : null;
}

/** Deterministic (StandardStatus, MlsStatus) -> CampaignStatus. Grounded in the
 *  live VOW feed: off-market is Cancelled/Expired (NOT StandardStatus 'Terminated'). */
export function mapStatus(standard?: string, mls?: string): CampaignStatus {
  const s = (standard ?? '').toLowerCase().trim();
  const m = (mls ?? '').toLowerCase().trim();
  if (s === 'closed' || m === 'sold' || m === 'leased') return 'Sold';
  if (s === 'active' || m === 'new' || m === 'price change' || m === 'extension' || m === 'active') return 'Active';
  if (s === 'cancelled' || s === 'canceled' || m === 'terminated') return 'Terminated';
  if (s === 'expired' || m === 'expired') return 'Expired';
  if (s === 'suspended' || m === 'suspended') return 'Suspended';
  return 'Active'; // unknown still-listed -> treat as on-market
}

function resolveEndDate(raw: RawVowCampaign, status: CampaignStatus): string | null {
  switch (status) {
    case 'Sold': return strOrNull(raw.CloseDate) ?? strOrNull(raw.PurchaseContractDate);
    case 'Terminated': return strOrNull(raw.TerminatedDate) ?? strOrNull(raw.UnavailableDate);
    case 'Expired': return strOrNull(raw.ExpirationDate) ?? strOrNull(raw.UnavailableDate);
    case 'Suspended': return strOrNull(raw.SuspendedDate) ?? strOrNull(raw.UnavailableDate);
    case 'Active': return null;
    default: return strOrNull(raw.UnavailableDate);
  }
}

export function normalizeCampaign(raw: RawVowCampaign): CampaignEvent | null {
  const listing_key = strOrNull(raw.ListingKey);
  if (!listing_key) return null;

  const status = mapStatus(raw.StandardStatus, raw.MlsStatus);
  const transaction_type: TransactionKind =
    String(raw.TransactionType ?? '').toLowerCase().includes('lease') ? 'Lease' : 'Sale';

  const list_price = numOrNull(raw.ListPrice);
  const original_list_price = numOrNull(raw.OriginalListPrice);
  const price_change_date =
    original_list_price != null && list_price != null && original_list_price !== list_price
      ? strOrNull(raw.PriceChangeTimestamp)
      : null;

  return {
    listing_key,
    transaction_type,
    status,
    entry_date: strOrNull(raw.OriginalEntryTimestamp),
    end_date: resolveEndDate(raw, status),
    end_reason: status === 'Active' ? null : status,
    list_price,
    original_list_price,
    close_price: numOrNull(raw.ClosePrice),
    brokerage: strOrNull(raw.ListOfficeName),
    price_change_date,
    address: strOrNull(raw.UnparsedAddress),
  };
}

/** Normalize a batch: drop unkeyed, dedupe by listing_key, sort newest-first by entry_date. */
export function normalizeCampaigns(raws: RawVowCampaign[]): CampaignEvent[] {
  const byKey = new Map<string, CampaignEvent>();
  for (const r of raws) {
    const e = normalizeCampaign(r);
    if (e && !byKey.has(e.listing_key)) byKey.set(e.listing_key, e);
  }
  return [...byKey.values()].sort((a, b) => {
    const at = a.entry_date ? Date.parse(a.entry_date) : 0;
    const bt = b.entry_date ? Date.parse(b.entry_date) : 0;
    return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
  });
}
