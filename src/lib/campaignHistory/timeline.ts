import { currentStitchedSaleSpan } from './trueDom';
import type { CampaignEvent, CampaignStatus, TransactionKind } from './types';

export type TimelineEventKind =
  | 'Listed for Sale' | 'Listed for Lease' | 'Price Changed'
  | 'Terminated' | 'Expired' | 'Suspended' | 'Sold';

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
    if (e.price_change_date && e.original_list_price != null && e.list_price != null && e.original_list_price !== e.list_price) {
      rows.push({
        ...base, date: e.price_change_date, kind: 'Price Changed',
        price: e.list_price,
        deltaPct: (e.list_price - e.original_list_price) / e.original_list_price,
      });
    }
    if (e.end_date && e.status !== 'Active') {
      rows.push({
        ...base, date: e.end_date, kind: e.status as TimelineEventKind,
        price: e.status === 'Sold' ? e.close_price : null, deltaPct: null,
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
      markers.push({ t: s.endT, price: s.e.status === 'Sold' ? (s.e.close_price ?? lastPrice) : lastPrice, kind: s.e.status as TimelineEventKind });
    }
    prevEndT = s.endT;
  });

  const span = currentStitchedSaleSpan(events, { nowMs: opts.nowMs, windowDays: opts.windowDays });
  const leasePeriods = events
    .filter((e) => e.transaction_type === 'Lease' && ms(e.entry_date) !== null)
    .map((e) => ({ startT: ms(e.entry_date)!, endT: ms(e.end_date) ?? opts.nowMs }));

  return { points, markers, stitchStartT: span?.startMs ?? null, stitchEndT: span?.endMs ?? null, leasePeriods };
}
