import { parseTimestamp } from '@/lib/typesense/TemporalDistressEngine';
import type { CampaignEvent, CampaignTrueDom, TransactionKind } from './types';

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 35;
const DEFAULT_STALE_DAYS = 60;

interface SpanNode {
  e: CampaignEvent;
  startMs: number;
  endMs: number | null; // real terminal date; nowMs while Active; null = unknown terminal (never stitched across)
}

function resolveEndMs(e: CampaignEvent, nowMs: number): number | null {
  const end = parseTimestamp(e.end_date);
  if (end !== null) return end;
  // Non-Active with no terminal date = ended at an UNKNOWN time. Treating it as
  // "ended now" made every historical gap negative, so such campaigns stitched
  // unconditionally and inflated true_dom by months/years (audit HIGH-9).
  return e.status === 'Active' ? nowMs : null;
}

export interface StitchedSpan {
  startMs: number;          // earliest stitched sale-campaign start
  endMs: number;            // now if newest sale is Active, else its terminal date
  originalListPrice: number | null; // earliest stitched original ask (for drop)
}

/** The current continuous campaign span for one transaction KIND (stitch
 *  consecutive campaigns of that kind whose gap prior.end→next.start ≤ windowDays).
 *  null when there are no parseable campaigns of that kind. */
export function currentStitchedSpan(
  events: CampaignEvent[],
  opts: { nowMs: number; windowDays?: number },
  kind: TransactionKind
): StitchedSpan | null {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const nodes: SpanNode[] = events
    .filter((e) => e.transaction_type === kind)
    .map((e) => ({ e, startMs: parseTimestamp(e.entry_date), endMs: 0 as number | null }))
    .filter((n): n is { e: CampaignEvent; startMs: number; endMs: number | null } => n.startMs !== null)
    .map((n) => ({ ...n, endMs: resolveEndMs(n.e, opts.nowMs) }))
    .sort((a, b) => b.startMs - a.startMs);
  if (nodes.length === 0) return null;

  const newest = nodes[0];
  // Active → measure to now. Known terminal → measure to it. UNKNOWN terminal →
  // contribute zero days rather than fabricating a span (conservative for a distress signal).
  const endMs = newest.e.status === 'Active' ? opts.nowMs : (newest.endMs ?? newest.startMs);
  let startMs = newest.startMs;
  let originalListPrice = newest.e.original_list_price ?? newest.e.list_price ?? null;
  let nextStartMs = newest.startMs;
  for (let i = 1; i < nodes.length; i++) {
    const prior = nodes[i];
    if (prior.endMs === null) break; // unknown terminal date — never stitch across it
    if (Math.floor((nextStartMs - prior.endMs) / DAY_MS) > windowDays) break;
    startMs = prior.startMs;
    const priorOrig = prior.e.original_list_price ?? prior.e.list_price;
    if (priorOrig != null) originalListPrice = priorOrig;
    nextStartMs = prior.startMs;
  }
  return { startMs, endMs, originalListPrice };
}

/** The current continuous SALE campaign span. Thin wrapper over currentStitchedSpan
 *  (kept as a named export — timeline.ts depends on it). */
export function currentStitchedSaleSpan(
  events: CampaignEvent[],
  opts: { nowMs: number; windowDays?: number }
): StitchedSpan | null {
  return currentStitchedSpan(events, opts, 'Sale');
}

/** DOM + price-drop for the current stitched span of one transaction kind. Zeroes
 *  when there is no parseable span of that kind. The price drop is the earliest
 *  stitched original ask minus the newest campaign's list price (never negative). */
function spanMetrics(
  events: CampaignEvent[],
  opts: { nowMs: number; windowDays?: number },
  kind: TransactionKind
): { trueDom: number; priceDrop: number } {
  const span = currentStitchedSpan(events, opts, kind);
  if (!span) return { trueDom: 0, priceDrop: 0 };
  const trueDom = Math.max(0, Math.floor((span.endMs - span.startMs) / DAY_MS));
  const newestList = events
    .filter((e) => e.transaction_type === kind && parseTimestamp(e.entry_date) !== null)
    .sort((a, b) => (parseTimestamp(b.entry_date) ?? 0) - (parseTimestamp(a.entry_date) ?? 0))[0]?.list_price ?? 0;
  const priceDrop =
    span.originalListPrice != null && newestList > 0
      ? Math.max(0, span.originalListPrice - newestList)
      : 0;
  return { trueDom, priceDrop };
}

/**
 * True DOM over a property's full campaign history, computed independently for the
 * SALE and LEASE tracks. Each counts the CURRENT continuous campaign of its kind:
 * stitch consecutive campaigns whose gap (prior end -> next start) is within
 * `windowDays`, then measure earliest-stitched-start -> now (or the newest
 * campaign's end if already off-market).
 *
 * `true_dom`/`total_price_drop` are the SALE track (staleness is a sale signal, so
 * `is_stale` keys on sale DOM only, unchanged). `lease_true_dom`/
 * `lease_total_price_drop` are the LEASE track — the rental-native metrics that back
 * the "For Rent" dashboard boards. A sale→lease flip therefore reports its sale drop
 * in `total_price_drop` and its (usually smaller) rent reduction in
 * `lease_total_price_drop`, never crossing the two. `campaign_count` counts all
 * campaigns of either kind (the "listed N times" signal).
 */
export function computeTrueDomFromCampaigns(
  events: CampaignEvent[],
  opts: { nowMs?: number; windowDays?: number; staleThresholdDays?: number } = {}
): CampaignTrueDom {
  const nowMs = opts.nowMs ?? Date.now();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const staleDays = opts.staleThresholdDays ?? DEFAULT_STALE_DAYS;

  const campaign_count = new Set(events.map((e) => e.listing_key)).size;

  const sale = spanMetrics(events, { nowMs, windowDays }, 'Sale');
  const lease = spanMetrics(events, { nowMs, windowDays }, 'Lease');

  return {
    true_dom: sale.trueDom,
    total_price_drop: sale.priceDrop,
    lease_true_dom: lease.trueDom,
    lease_total_price_drop: lease.priceDrop,
    campaign_count,
    is_stale: sale.trueDom > staleDays,
  };
}
