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

export interface StitchedSpan {
  startMs: number;          // earliest stitched sale-campaign start
  endMs: number;            // now if newest sale is Active, else its terminal date
  originalListPrice: number | null; // earliest stitched original ask (for drop)
}

/** The current continuous SALE campaign span (stitch consecutive sales whose
 *  gap prior.end→next.start ≤ windowDays). null when there are no parseable sales. */
export function currentStitchedSaleSpan(
  events: CampaignEvent[],
  opts: { nowMs: number; windowDays?: number }
): StitchedSpan | null {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const sales = events
    .filter((e) => e.transaction_type === 'Sale')
    .map((e) => ({ e, startMs: parseTimestamp(e.entry_date), endMs: 0 }))
    .filter((n): n is { e: CampaignEvent; startMs: number; endMs: number } => n.startMs !== null)
    .map((n) => ({ ...n, endMs: resolveEndMs(n.e, opts.nowMs) }))
    .sort((a, b) => b.startMs - a.startMs);
  if (sales.length === 0) return null;

  const newest = sales[0];
  const endMs = newest.e.status === 'Active' ? opts.nowMs : newest.endMs;
  let startMs = newest.startMs;
  let originalListPrice = newest.e.original_list_price ?? newest.e.list_price ?? null;
  let nextStartMs = newest.startMs;
  for (let i = 1; i < sales.length; i++) {
    const prior = sales[i];
    if (Math.floor((nextStartMs - prior.endMs) / DAY_MS) > windowDays) break;
    startMs = prior.startMs;
    const priorOrig = prior.e.original_list_price ?? prior.e.list_price;
    if (priorOrig != null) originalListPrice = priorOrig;
    nextStartMs = prior.startMs;
  }
  return { startMs, endMs, originalListPrice };
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

  // counts ALL campaigns (sale + lease) for the "listed N times" signal — deliberately not just the sale campaigns that feed true_dom
  const campaign_count = new Set(events.map((e) => e.listing_key)).size;

  const span = currentStitchedSaleSpan(events, { nowMs, windowDays });
  if (!span) {
    return { true_dom: 0, total_price_drop: 0, campaign_count, is_stale: false };
  }
  const true_dom = Math.max(0, Math.floor((span.endMs - span.startMs) / DAY_MS));
  const newestSaleList = events
    .filter((e) => e.transaction_type === 'Sale' && parseTimestamp(e.entry_date) !== null)
    .sort((a, b) => (parseTimestamp(b.entry_date) ?? 0) - (parseTimestamp(a.entry_date) ?? 0))[0]?.list_price ?? 0;
  const total_price_drop =
    span.originalListPrice != null && newestSaleList > 0
      ? Math.max(0, span.originalListPrice - newestSaleList)
      : 0;
  return { true_dom, total_price_drop, campaign_count, is_stale: true_dom > staleDays };
}
