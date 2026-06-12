import { currentStitchedSaleSpan } from './trueDom';
import type { CampaignEvent, CampaignStatus, TransactionKind } from './types';

export type TimelineEventKind =
  | 'Listed for Sale' | 'Listed for Lease' | 'Price Changed'
  | 'Terminated' | 'Expired' | 'Suspended' | 'Sold' | 'Leased';

export interface TimelineRow {
  date: string;
  kind: TimelineEventKind;
  price: number | null;
  deltaPct: number | null;
  listingKey: string;
  status: CampaignStatus;
  transactionType: TransactionKind;
  brokerage: string | null;
  address: string | null;
}

function ms(d: string | null): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : t;
}

/** Explode each campaign into Listed / Price Changed / terminal rows, newest-first. */
export function buildEventRows(events: CampaignEvent[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const e of events) {
    const base = {
      listingKey: e.listing_key, status: e.status, transactionType: e.transaction_type,
      brokerage: e.brokerage, address: e.address,
    };
    if (e.entry_date) {
      rows.push({
        ...base, date: e.entry_date,
        kind: e.transaction_type === 'Lease' ? 'Listed for Lease' : 'Listed for Sale',
        price: e.original_list_price ?? e.list_price, deltaPct: null,
      });
    }
    if (e.price_change_date && e.original_list_price != null && e.original_list_price > 0 && e.list_price != null && e.original_list_price !== e.list_price) {
      rows.push({
        ...base, date: e.price_change_date, kind: 'Price Changed',
        price: e.list_price,
        deltaPct: (e.list_price - e.original_list_price) / e.original_list_price,
      });
    }
    if (e.end_date && e.status !== 'Active') {
      rows.push({
        ...base, date: e.end_date, kind: e.status as TimelineEventKind,
        price: e.status === 'Sold' || e.status === 'Leased' ? e.close_price : null, deltaPct: null,
      });
    }
  }
  return rows.sort((a, b) => (ms(b.date) ?? 0) - (ms(a.date) ?? 0));
}

export interface ChartPoint { t: number; price: number | null; }
export interface ChartMarker { t: number; price: number; kind: TimelineEventKind; }
export interface SaleChartSeries {
  points: ChartPoint[];
  markers: ChartMarker[];
  stitchStartT: number | null;
  stitchEndT: number | null;
  leasePeriods: { startT: number; endT: number }[];
}

/** Sale-price trajectory across campaigns with off-market gaps + the stitched window. */
export function buildSaleChartSeries(
  events: CampaignEvent[],
  opts: { nowMs: number; windowDays?: number }
): SaleChartSeries {
  const sales = events
    .filter((e) => e.transaction_type === 'Sale' && ms(e.entry_date) !== null)
    .map((e) => ({ e, startT: ms(e.entry_date)!, endT: ms(e.end_date) ?? opts.nowMs }))
    .sort((a, b) => a.startT - b.startT);

  const points: ChartPoint[] = [];
  const markers: ChartMarker[] = [];
  let prevEndT: number | null = null;

  sales.forEach((s, i) => {
    if (prevEndT != null && s.startT > prevEndT) {
      points.push({ t: prevEndT, price: null });
      points.push({ t: s.startT, price: null });
    }
    const orig = s.e.original_list_price ?? s.e.list_price ?? null;
    if (orig != null) {
      points.push({ t: s.startT, price: orig });
      markers.push({ t: s.startT, price: orig, kind: 'Listed for Sale' });
    }
    const pcT = ms(s.e.price_change_date);
    if (pcT != null && s.e.list_price != null && orig != null && s.e.list_price !== orig) {
      points.push({ t: pcT, price: s.e.list_price });
      markers.push({ t: pcT, price: s.e.list_price, kind: 'Price Changed' });
    }
    const isNewest = i === sales.length - 1;
    const lastPrice = s.e.list_price ?? orig;
    if (isNewest && s.e.status === 'Active' && lastPrice != null) {
      points.push({ t: opts.nowMs, price: lastPrice });
    } else if (s.e.status !== 'Active' && lastPrice != null) {
      points.push({ t: s.endT, price: lastPrice });
      markers.push({ t: s.endT, price: (s.e.status === 'Sold' || s.e.status === 'Leased') ? (s.e.close_price ?? lastPrice) : lastPrice, kind: s.e.status as TimelineEventKind });
    }
    prevEndT = s.endT;
  });

  const span = currentStitchedSaleSpan(events, { nowMs: opts.nowMs, windowDays: opts.windowDays });
  const leasePeriods = events
    .filter((e) => e.transaction_type === 'Lease' && ms(e.entry_date) !== null)
    .map((e) => ({ startT: ms(e.entry_date)!, endT: ms(e.end_date) ?? opts.nowMs }));

  return { points, markers, stitchStartT: span?.startMs ?? null, stitchEndT: span?.endMs ?? null, leasePeriods };
}

// ─── Treatment-2 builders (campaign ribbon + event-spaced price path) ─────────

/** One time-scaled bar for the campaign ribbon (sale OR lease). */
export interface CampaignBar {
  listingKey: string;
  kind: TransactionKind;          // 'Sale' | 'Lease'
  startMs: number;
  endMs: number;                  // end_date, or nowMs while Active
  startPrice: number | null;      // original list (fallback: list)
  endPrice: number | null;        // last list price IFF it changed (for "a → b")
  priceChanged: boolean;
  endStatus: CampaignStatus;      // Active / Terminated / Expired / Suspended / Sold
  isCurrent: boolean;             // overlaps the current stitched sale span (or Active sale)
}

/** One bar per campaign, time-ordered (oldest → newest), for the "by date" ribbon lane. */
export function buildCampaignBars(
  events: CampaignEvent[],
  opts: { nowMs: number; windowDays?: number }
): CampaignBar[] {
  const span = currentStitchedSaleSpan(events, { nowMs: opts.nowMs, windowDays: opts.windowDays });
  const bars: CampaignBar[] = [];
  for (const e of events) {
    const startMs = ms(e.entry_date);
    if (startMs == null) continue;
    const endMs = Math.max(ms(e.end_date) ?? opts.nowMs, startMs);
    const isSale = e.transaction_type === 'Sale';
    const changed =
      e.price_change_date != null && e.original_list_price != null &&
      e.list_price != null && e.original_list_price !== e.list_price;
    const overlapsSpan = span != null && isSale && startMs <= span.endMs && endMs >= span.startMs;
    bars.push({
      listingKey: e.listing_key,
      kind: e.transaction_type,
      startMs,
      endMs,
      startPrice: e.original_list_price ?? e.list_price,
      endPrice: changed ? e.list_price : null,
      priceChanged: changed,
      endStatus: e.status,
      isCurrent: overlapsSpan || (isSale && e.status === 'Active'),
    });
  }
  return bars.sort((a, b) => a.startMs - b.startMs);
}

/** One point on the event-spaced "asking-price path" lane (SALE campaigns only). */
export interface PricePathPoint {
  price: number;
  dateMs: number;                 // for the date label only — NOT the x position (path is evenly spaced)
  kind: 'Listed' | 'Price Changed';
  endStatus: CampaignStatus | null; // non-null on a campaign's LAST point (its end state)
  listingKey: string;
  offMarketBefore: boolean;       // a NON-stitched gap precedes this campaign → draw the segment dashed
  isCurrent: boolean;             // campaign overlaps the current stitched span
}

/**
 * Sale-price events in chronological order, evenly spaced by the renderer.
 * Segments across a real off-market gap are flagged for dashing — UNLESS the two
 * campaigns are stitched into the same current span (then the effort is continuous → solid).
 */
export function buildSalePricePath(
  events: CampaignEvent[],
  opts: { nowMs: number; windowDays?: number }
): PricePathPoint[] {
  const span = currentStitchedSaleSpan(events, { nowMs: opts.nowMs, windowDays: opts.windowDays });
  const sales = events
    .filter((e) => e.transaction_type === 'Sale' && ms(e.entry_date) !== null)
    .map((e) => ({ e, startMs: ms(e.entry_date)!, endMs: ms(e.end_date) ?? opts.nowMs }))
    .sort((a, b) => a.startMs - b.startMs);

  const path: PricePathPoint[] = [];
  let prevEndMs: number | null = null;
  let prevInSpan = false;

  for (const { e, startMs, endMs } of sales) {
    const inSpan = span != null && startMs <= span.endMs && endMs >= span.startMs;
    const gap = prevEndMs != null && startMs > prevEndMs;
    const offMarketBefore = gap && !(prevInSpan && inSpan);
    const orig = e.original_list_price ?? e.list_price;
    const changed =
      e.price_change_date != null && e.original_list_price != null &&
      e.list_price != null && e.original_list_price !== e.list_price;

    const pts: PricePathPoint[] = [];
    if (orig != null) {
      pts.push({ price: orig, dateMs: startMs, kind: 'Listed', endStatus: null, listingKey: e.listing_key, offMarketBefore, isCurrent: inSpan });
    }
    if (changed && e.list_price != null) {
      pts.push({ price: e.list_price, dateMs: ms(e.price_change_date) ?? startMs, kind: 'Price Changed', endStatus: null, listingKey: e.listing_key, offMarketBefore: false, isCurrent: inSpan });
    }
    if (pts.length > 0) {
      pts[pts.length - 1].endStatus = e.status; // last point carries the campaign's end state
      path.push(...pts);
    }
    prevEndMs = endMs;
    prevInSpan = inSpan;
  }
  return path;
}

/** Headline figures for the panel: first sale list → latest sale list, and the % move. */
export interface HistorySummary {
  originalSalePrice: number | null;
  currentSalePrice: number | null;
  dropPct: number | null;          // (current − original) / original; negative = price cut
}

export function summarizeSaleHistory(events: CampaignEvent[]): HistorySummary {
  const sales = events
    .filter((e) => e.transaction_type === 'Sale' && ms(e.entry_date) !== null)
    .sort((a, b) => ms(a.entry_date)! - ms(b.entry_date)!);
  if (sales.length === 0) return { originalSalePrice: null, currentSalePrice: null, dropPct: null };
  const originalSalePrice = sales[0].original_list_price ?? sales[0].list_price;
  const last = sales[sales.length - 1];
  const currentSalePrice = last.list_price ?? last.original_list_price;
  const dropPct =
    originalSalePrice != null && currentSalePrice != null && originalSalePrice !== 0
      ? (currentSalePrice - originalSalePrice) / originalSalePrice
      : null;
  return { originalSalePrice, currentSalePrice, dropPct };
}
