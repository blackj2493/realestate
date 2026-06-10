/**
 * Pure mapping layer for de-listed (Terminated/Expired/Suspended) VOW records —
 * kept free of env/IO imports so vitest loads it directly. IO (cursor, upserts,
 * feed fetch, CLI) lives in delistedIndexer.ts.
 *
 * Design spec: docs/superpowers/specs/2026-06-09-delisted-mode-design.md
 */
import {
  deriveDelistedDealType,
  type DelistedDealType,
} from '../../src/lib/sold/dealType';
import type { SoldListingDocument } from '../../src/lib/typesense/soldListingsSchema';
import { parsePostalFromAddress } from './parsePostal';

function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function toFloat(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** YYYY-MM-DD from a date-ish string; null when unparseable. */
function isoDateOrNull(v: unknown): string | null {
  if (!v || typeof v !== 'string') return null;
  const ms = new Date(v).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Raw VOW fields the event-date precedence reads. */
export interface DelistedDateFields {
  MlsStatus?: string | null;
  TerminatedDate?: string | null;
  SuspendedDate?: string | null;
  ExpirationDate?: string | null;
  ModificationTimestamp?: string | null;
}

/**
 * The de-list EVENT date (YYYY-MM-DD): the status-specific date field when
 * present and not in the future (Suspended rows often carry a future
 * ExpirationDate), else the ModificationTimestamp date, else null (caller
 * skips the record — a row without an event date can never be windowed).
 */
export function delistedEventDate(
  raw: DelistedDateFields,
  nowMs: number
): string | null {
  const reason = deriveDelistedDealType(raw.MlsStatus);
  const specific =
    reason === 'terminated'
      ? raw.TerminatedDate
      : reason === 'suspended'
        ? raw.SuspendedDate
        : reason === 'expired'
          ? raw.ExpirationDate
          : null;
  // Allow 1 day of clock skew before calling a date "future".
  const maxMs = nowMs + 86_400_000;
  for (const candidate of [specific, raw.ModificationTimestamp]) {
    const d = isoDateOrNull(candidate ?? null);
    if (d && new Date(d).getTime() <= maxMs) return d;
  }
  return null;
}

/** Slim raw_vow_delisted row + the derived deal_type (not a table column). */
export interface DelistedRecord {
  listing_key: string;
  mls_status: string | null;
  standard_status: string | null;
  transaction_type: string | null;
  delisted_date: string; // YYYY-MM-DD, NOT NULL by construction
  expiration_date: string | null;
  listing_contract_date: string | null;
  list_price: number | null;
  original_list_price: number | null;
  days_on_market: number | null;
  unparsed_address: string | null;
  city: string | null;
  city_region: string | null;
  postal_code: string | null;
  property_sub_type: string | null;
  bedrooms_above_grade: number | null;
  bathrooms_total_integer: number | null;
  parking_total: number | null;
  list_office_name: string | null;
  /** Derived reason — used for the Typesense doc; not a table column. */
  deal_type: DelistedDealType;
}

/**
 * Raw VOW listing → slim archive record. Null when the status is not a
 * de-list signal or no event date can be established.
 */
export function extractDelistedRecord(
  raw: any,
  nowMs: number
): DelistedRecord | null {
  const dealType = deriveDelistedDealType(raw?.MlsStatus);
  if (!dealType) return null;
  const listingKey = raw.ListingKey || raw.ListingId || '';
  if (!listingKey) return null;
  const eventDate = delistedEventDate(raw, nowMs);
  if (!eventDate) return null;

  const address =
    raw.UnparsedAddress ||
    [raw.StreetNumber, raw.StreetName, raw.UnitNumber].filter(Boolean).join(' ') ||
    null;

  return {
    listing_key: listingKey,
    mls_status: raw.MlsStatus || null,
    standard_status: raw.StandardStatus || null,
    transaction_type: raw.TransactionType || null,
    delisted_date: eventDate,
    expiration_date: isoDateOrNull(raw.ExpirationDate),
    listing_contract_date: isoDateOrNull(raw.ListingContractDate),
    list_price: numOrNull(raw.ListPrice),
    original_list_price: numOrNull(raw.OriginalListPrice),
    days_on_market: numOrNull(raw.DaysOnMarket),
    unparsed_address: address,
    city: raw.City || null,
    city_region: raw.CityRegion || null,
    // VOW postal_code is frequently FSA-only; the full postal is in the address
    // (sold-blob lesson — parsePostal.ts). Prefer it; fall back to the column.
    postal_code: parsePostalFromAddress(address) ?? (raw.PostalCode || null),
    property_sub_type: raw.PropertySubType || raw.PropertyType || null,
    bedrooms_above_grade: numOrNull(raw.BedroomsAboveGrade),
    bathrooms_total_integer: numOrNull(raw.BathroomsTotalInteger),
    parking_total: numOrNull(raw.ParkingTotal),
    list_office_name: raw.ListOfficeName || null,
    deal_type: dealType,
  };
}

/**
 * Slim record → strict-schema sold_listings doc. DealType carries the de-list
 * reason; PurchaseContractDate (the window/sort slot) carries the DE-LIST date;
 * ClosePrice is 0 (no transaction — the route's price floor is sold/leased-only).
 * Geocoding (location/NearbySchools) is attached by the indexer, not here,
 * to keep this module IO-free.
 */
export function toDelistedDocument(r: DelistedRecord): SoldListingDocument | null {
  if (!r.listing_key) return null;
  const ms = new Date(r.delisted_date).getTime();
  if (!Number.isFinite(ms)) return null;
  return {
    id: r.listing_key,
    ClosePrice: 0,
    ListPrice: toInt(r.list_price),
    City: r.city ?? '',
    CityRegion: r.city_region ?? '',
    UnparsedAddress: r.unparsed_address ?? '',
    PropertySubType: r.property_sub_type ?? '',
    BedroomsTotal: toInt(r.bedrooms_above_grade),
    BathroomsTotalInteger: toFloat(r.bathrooms_total_integer),
    BuildingAreaTotal: 0,
    ParkingTotal: toInt(r.parking_total),
    LotWidth: 0,
    BasementTier: 0,
    ListOfficeName: r.list_office_name ?? '',
    PurchaseContractDate: ms,
    DealType: r.deal_type,
    DaysOnMarket: toInt(r.days_on_market),
    TransactionType: r.transaction_type ?? '',
    OriginalListPrice: toInt(r.original_list_price),
  };
}
