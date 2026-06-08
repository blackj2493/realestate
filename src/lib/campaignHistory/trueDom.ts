import { parseTimestamp } from '@/lib/typesense/TemporalDistressEngine';
import type { CampaignEvent, CampaignTrueDom } from './types';

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 35;
const DEFAULT_STALE_DAYS = 60;

interface SaleNode {
  e: CampaignEvent;
  startMs: number;
  endMs: number; // real terminal date, or nowMs for Active / unknown end
}

function resolveEndMs(e: CampaignEvent, nowMs: number): number {
  const end = parseTimestamp(e.end_date);
  return end !== null ? end : nowMs;
}

/**
 * True DOM over a property's full campaign history. Counts the CURRENT continuous
 * SALE campaign: stitch consecutive sale campaigns whose gap (prior end -> next
 * start) is within `windowDays`, then measure earliest-stitched-start -> now (or
 * the newest campaign's end if it is already off-market). Lease campaigns are
 * excluded from the number but counted in campaign_count.
 */
export function computeTrueDomFromCampaigns(
  events: CampaignEvent[],
  opts: { nowMs?: number; windowDays?: number; staleThresholdDays?: number } = {}
): CampaignTrueDom {
  const nowMs = opts.nowMs ?? Date.now();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const staleDays = opts.staleThresholdDays ?? DEFAULT_STALE_DAYS;

  const campaign_count = new Set(events.map((e) => e.listing_key)).size;

  const sales: SaleNode[] = events
    .filter((e) => e.transaction_type === 'Sale')
    .map((e) => ({ e, startMs: parseTimestamp(e.entry_date), endMs: 0 }))
    .filter((n): n is { e: CampaignEvent; startMs: number; endMs: number } => n.startMs !== null)
    .map((n) => ({ ...n, endMs: resolveEndMs(n.e, nowMs) }))
    .sort((a, b) => b.startMs - a.startMs); // newest first

  if (sales.length === 0) {
    return { true_dom: 0, total_price_drop: 0, campaign_count, is_stale: false };
  }

  const newest = sales[0];
  const runEndMs = newest.e.status === 'Active' ? nowMs : newest.endMs;
  let earliestStartMs = newest.startMs;
  let originalListPrice = newest.e.original_list_price ?? newest.e.list_price ?? null;
  let nextStartMs = newest.startMs;

  for (let i = 1; i < sales.length; i++) {
    const prior = sales[i];
    const gapDays = Math.floor((nextStartMs - prior.endMs) / DAY_MS);
    if (gapDays > windowDays) break; // genuine separate selling effort
    earliestStartMs = prior.startMs;
    const priorOrig = prior.e.original_list_price ?? prior.e.list_price;
    if (priorOrig != null) originalListPrice = priorOrig;
    nextStartMs = prior.startMs;
  }

  const true_dom = Math.max(0, Math.floor((runEndMs - earliestStartMs) / DAY_MS));
  const currentList = newest.e.list_price ?? 0;
  const total_price_drop =
    originalListPrice != null && currentList > 0
      ? Math.max(0, originalListPrice - currentList)
      : 0;

  return { true_dom, total_price_drop, campaign_count, is_stale: true_dom > staleDays };
}
