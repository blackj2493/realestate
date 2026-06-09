import type { SupabaseClient } from '@supabase/supabase-js';
import { computeTrueDomFromCampaigns } from './trueDom';
import type { CampaignEvent } from './types';

/** One row of property_campaign_history (matches migration 032). */
export interface CampaignHistoryRow {
  property_hash: string;
  events: CampaignEvent[];
  true_dom: number;
  total_price_drop: number;
  campaign_count: number;
  first_seen_date: string | null;
  is_stale: boolean;
  fetched_at: string;
}

function entryMs(e: CampaignEvent): number | null {
  if (!e.entry_date) return null;
  const t = Date.parse(e.entry_date);
  return Number.isNaN(t) ? null : t;
}

/**
 * Guarantee the subject listing is in the event set (subject-always-present, so a
 * feed lag never yields an empty history / true_dom=0), dedupe by listing_key with
 * the subject winning, newest-first by entry_date.
 */
export function mergeSubjectEvent(
  events: CampaignEvent[],
  subject: CampaignEvent | null
): CampaignEvent[] {
  const byKey = new Map<string, CampaignEvent>();
  if (subject) byKey.set(subject.listing_key, subject);
  for (const e of events) if (!byKey.has(e.listing_key)) byKey.set(e.listing_key, e);
  return [...byKey.values()].sort((a, b) => (entryMs(b) ?? 0) - (entryMs(a) ?? 0));
}

/** Earliest entry_date across events, as a YYYY-MM-DD string (or null). */
function oldestEntryDate(events: CampaignEvent[]): string | null {
  let oldestMs: number | null = null;
  let oldestIso: string | null = null;
  for (const e of events) {
    const t = entryMs(e);
    if (t === null) continue;
    if (oldestMs === null || t < oldestMs) {
      oldestMs = t;
      oldestIso = e.entry_date;
    }
  }
  return oldestIso ? oldestIso.slice(0, 10) : null;
}

/** Build the persisted ledger row from a property's campaign events. Pure (now injected). */
export function buildCampaignHistoryRow(
  propertyHash: string,
  events: CampaignEvent[],
  opts: { nowMs: number }
): CampaignHistoryRow {
  const m = computeTrueDomFromCampaigns(events, { nowMs: opts.nowMs });
  return {
    property_hash: propertyHash,
    events,
    true_dom: m.true_dom,
    total_price_drop: m.total_price_drop,
    campaign_count: m.campaign_count,
    first_seen_date: oldestEntryDate(events),
    is_stale: m.is_stale,
    fetched_at: new Date(opts.nowMs).toISOString(),
  };
}

const TTL_HOURS = 24;

/** True when the ledger row is missing/expired and should be refreshed from the feed. */
export function isLedgerStale(fetchedAt: string | null, nowMs: number, ttlHours: number = TTL_HOURS): boolean {
  if (!fetchedAt) return true;
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) return true;
  return nowMs - t > ttlHours * 3_600_000;
}

/**
 * Never-regress guard: when a refresh fetch returned NO campaigns (transient feed
 * failure → only the subject is in `fresh`), keep a richer prior row rather than
 * collapsing the history. Otherwise the freshly-built row wins.
 */
export function preferFreshOrPrior(
  fresh: CampaignHistoryRow,
  prior: CampaignHistoryRow | null,
  fetchedCount: number
): CampaignHistoryRow {
  if (fetchedCount === 0 && prior && prior.campaign_count > fresh.campaign_count) return prior;
  return fresh;
}

/** Read the ledger row for a property_hash (PK point-lookup). null when absent. */
export async function readCampaignHistory(
  supabase: SupabaseClient,
  propertyHash: string
): Promise<CampaignHistoryRow | null> {
  const { data } = await supabase
    .from('property_campaign_history')
    .select(
      'property_hash, events, true_dom, total_price_drop, campaign_count, first_seen_date, is_stale, fetched_at'
    )
    .eq('property_hash', propertyHash)
    .maybeSingle();
  return (data as CampaignHistoryRow | null) ?? null;
}

/** Upsert a ledger row (onConflict property_hash). */
export async function upsertCampaignHistory(
  supabase: SupabaseClient,
  row: CampaignHistoryRow
): Promise<void> {
  const { error } = await supabase
    .from('property_campaign_history')
    .upsert(row, { onConflict: 'property_hash' });
  if (error) throw error;
}
