/**
 * The monthly Ontario Housing Market Report (/data/reports and /data/reports/{YYYY-MM}).
 *
 * WHY. Journalists and AI answers cite dated monthly reports ("Ontario housing market report
 * November 2026"). Our trackers update every night, so a figure quoted today is gone next
 * week. An edition freezes the month's figures at one permanent URL, so a citation keeps
 * pointing at the numbers it quoted.
 *
 * DATA. Each edition is a committed snapshot, data/reports/{YYYY-MM}.json, written by
 * scripts/data/buildMonthlyReport.ts from the same sources the trackers read: the market
 * board (region_metrics), the same-home price change (data/price-change.json), the power-of-sale
 * counts (pos_monthly_stats) and the published bank forecasts. Aggregates only.
 *
 * The edition is named for the month it is published in; its figures run to the last full
 * month before it ("November 2026" edition = sales to October 31, 2026).
 *
 * This file is pure (no IO): the builder for the script, and the types and helpers for the
 * pages. The page loader is src/lib/data/reportEditions.ts.
 */
import type { MarketRow } from "./marketBoard";
import { buildOutlook } from "./marketOutlook";
import { buildPosIndex, type PosMonthRow } from "./posIndex";
import type { PriceChangeFile } from "./priceChange";
import type { ForecastRange } from "./bankForecasts";
import { cityHubSlug } from "@/lib/listings/listingPath";

import { editionLabel, reportTitle } from "./reportPaths";
export { editionLabel, reportPath, reportTitle } from "./reportPaths";

/** A city's year-on-year sales change needs this many sales in each 3-month window. */
const MIN_CITY_SALES = 90;

export type Audience = "Buyers" | "Sellers" | "Owners";

export interface ReportFinding {
  id: string;
  audience: Audience;
  /** Short headline, e.g. "Prices are lower than a year ago". */
  title: string;
  /** One or two sentences with the numbers and their dates. */
  text: string;
}

export interface ReportCity {
  city: string;
  slug: string;
  /** Sales-weighted 3-month median sale price, all home types. */
  medianPrice: number | null;
  priceYoYPct: number | null;
  sales3m: number | null;
  salesYoYPct: number | null;
  /** Average sale-to-final-asking price (%), 3 months. */
  saleToAskPct: number | null;
  /** Median days a sold home was listed, 12 months. */
  medianDom: number | null;
  /** Share of homes for sale with a price cut (%), at the snapshot date. */
  cutPct: number | null;
  /** Share of sales below the first asking price (%), 12 months. */
  underAskPct: number | null;
  marketType: string | null;
}

export interface ReportEdition {
  edition: string;
  label: string;
  title: string;
  /** ISO time the snapshot was taken. */
  publishedAt: string;
  /** ISO time of the market board data. */
  dataAsOf: string;
  /** "August to October 2026": the 3 full months the city figures cover. */
  span: string;
  /** "October 2026": the last full month in the figures. */
  lastMonth: string;
  summary: string;
  findings: ReportFinding[];
  /** Same-home price change, Ontario, 12 months against the 12 before. */
  sameHome: {
    window: string;
    earlierWindow: string;
    pct: number;
    lo: number;
    hi: number;
    significant: boolean;
    shareDownPct: number;
    detachedPct: number | null;
    condoAptPct: number | null;
    quarters: { label: string; pct: number }[];
  } | null;
  /** The cities in the table, combined (sums only; medians are never pooled). */
  combined: {
    cities: number;
    sales3m: number;
    salesBefore: number;
    salesYoYPct: number;
    /** Weighted by each city's 12-month sales. */
    underAskPct: number | null;
    /** Weighted by each city's homes for sale. */
    cutPct: number | null;
    forSale: number | null;
  } | null;
  pos: { from: string; to: string; sharePct: number; prevSharePct: number | null; pos: number; sales: number } | null;
  cities: ReportCity[];
  /** The bank forecasts as published at the snapshot date (frozen with the edition). */
  forecasts: ForecastRange | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct1 = (n: number) => `${Math.abs(n).toFixed(1)}%`;
const pct0 = (n: number) => `${Math.round(Math.abs(n))}%`;
const count = (n: number) => Math.round(n).toLocaleString("en-CA");
/** Prices in the report are rounded to the nearest $1,000. */
export const usdK = (n: number) => `$${(Math.round(n / 1000) * 1000).toLocaleString("en-CA")}`;
/** "−6.8%" / "+1.7%" with a true minus sign. */
export const signedPct = (n: number, d = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}%`;
/** "2025-11-01" → "November 2025". */
const longMonth = (iso: string) => editionLabel(iso.slice(0, 7));
/** The month before an exclusive "YYYY-MM-01" end: "2026-11-01" → "October 2026". */
const monthBefore = (iso: string) => {
  const t = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 2;
  return editionLabel(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`);
};
/** "August 2026" + "October 2026" → "August to October 2026". */
const spanOf = (from: string, to: string) => (from.slice(-4) === to.slice(-4) ? `${from.split(" ")[0]} to ${to}` : `${from} to ${to}`);

/** The edition a snapshot taken at `iso` belongs to: its Toronto month. */
export function editionFor(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }).slice(0, 7);
}

export interface ReportInputs {
  publishedAt: string;
  board: { rows: MarketRow[]; dataAsOf: string | null };
  priceChange: PriceChangeFile;
  posRows: PosMonthRow[];
  forecasts: ForecastRange | null;
}

export function buildReportEdition(inp: ReportInputs): ReportEdition | null {
  const { board } = inp;
  if (!board.dataAsOf || board.rows.length === 0) return null;
  const edition = editionFor(inp.publishedAt);

  // ── Cities (the market board: 3 full months against the same months a year earlier) ──
  let span: string | null = null;
  let lastFull: string | null = null;
  const cities: ReportCity[] = [];
  for (const row of board.rows) {
    const o = buildOutlook(row.region, row, board.dataAsOf);
    if (!o) continue;
    const s = o.stats;
    span ??= s.span;
    lastFull ??= o.table[0]?.label ?? null;
    const salesOk = s.sales && s.sales.now >= MIN_CITY_SALES && s.sales.before >= MIN_CITY_SALES;
    cities.push({
      city: row.region,
      slug: cityHubSlug(row.region),
      medianPrice: s.price ? Math.round(s.price.now) : null,
      priceYoYPct: s.price ? r1((s.price.now / s.price.before - 1) * 100) : null,
      sales3m: s.sales ? s.sales.now : null,
      salesYoYPct: salesOk && s.sales ? r1((s.sales.now / s.sales.before - 1) * 100) : null,
      saleToAskPct: s.s2l ? r1(s.s2l.now) : null,
      medianDom: row.soldMedianDom != null ? Math.round(row.soldMedianDom) : null,
      cutPct: s.cutPct,
      underAskPct: s.underAskPct,
      marketType: o.marketType,
    });
  }
  if (!span || !lastFull || cities.length < 3) return null;
  cities.sort((a, b) => (b.sales3m ?? 0) - (a.sales3m ?? 0));

  // ── Combined (sums and weighted shares; no pooled medians) ──
  const withSales = board.rows
    .map((row) => ({ row, o: buildOutlook(row.region, row, board.dataAsOf) }))
    .filter((x) => x.o?.stats.sales);
  const sales3m = withSales.reduce((n, x) => n + x.o!.stats.sales!.now, 0);
  const salesBefore = withSales.reduce((n, x) => n + x.o!.stats.sales!.before, 0);
  const weighted = (pairs: { v: number | null; w: number | null }[]) => {
    const ok = pairs.filter((p): p is { v: number; w: number } => p.v != null && p.w != null && p.w > 0);
    const w = ok.reduce((n, p) => n + p.w, 0);
    return w > 0 ? r1((ok.reduce((n, p) => n + p.v * p.w, 0) / w) * 100) : null;
  };
  const combined =
    withSales.length >= 3 && salesBefore > 0
      ? {
          cities: withSales.length,
          sales3m,
          salesBefore,
          salesYoYPct: r1((sales3m / salesBefore - 1) * 100),
          underAskPct: weighted(board.rows.map((r) => ({ v: r.underAskShare, w: r.soldCount12m }))),
          cutPct: weighted(board.rows.map((r) => ({ v: r.cutShare, w: r.cutActive }))),
          forSale: board.rows.reduce((n, r) => n + (r.cutActive ?? 0), 0) || null,
        }
      : null;

  // ── Same-home price change, Ontario ──
  const pc = inp.priceChange;
  const a = pc.ontario.all;
  const sameHome = a
    ? {
        window: spanOf(longMonth(pc.laterFrom), monthBefore(pc.laterTo)),
        earlierWindow: spanOf(longMonth(pc.earlierFrom), monthBefore(pc.laterFrom)),
        pct: r1(a.pct),
        lo: r1(a.lo),
        hi: r1(a.hi),
        significant: a.significant,
        shareDownPct: Math.round(a.shareDown * 100),
        detachedPct: pc.ontario.byType.detached ? r1(pc.ontario.byType.detached.pct) : null,
        condoAptPct: pc.ontario.byType.condoApt ? r1(pc.ontario.byType.condoApt.pct) : null,
        quarters: pc.ontario.quarters.filter((q) => q.all).map((q) => ({ label: q.label, pct: r1(q.all!.pct) })),
      }
    : null;

  // ── Power of sale: the 3 months to the last full month ──
  const lastYm = (() => {
    const t = Number(edition.slice(0, 4)) * 12 + Number(edition.slice(5, 7)) - 2;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  })();
  const posEd = inp.posRows.length ? buildPosIndex(inp.posRows, lastYm) : null;
  const pos = posEd
    ? { from: spanOf(posEd.hero.from, posEd.label).split(" to ")[0], to: posEd.label, sharePct: Math.round(posEd.hero.sharePct * 100) / 100, prevSharePct: posEd.hero.prevSharePct != null ? Math.round(posEd.hero.prevSharePct * 100) / 100 : null, pos: posEd.hero.pos, sales: posEd.hero.sales }
    : null;

  // ── Key findings, each for one reader ──
  const findings: ReportFinding[] = [];
  if (sameHome?.significant) {
    const qs = sameHome.quarters;
    const worst = qs.length ? qs.reduce((m, q) => (q.pct < m.pct ? q : m)) : null;
    const last = qs[qs.length - 1];
    const easing = worst && last && last.label !== worst.label && last.pct > worst.pct + 0.5;
    findings.push({
      id: "same_home",
      audience: "Owners",
      title: sameHome.pct < 0 ? "Homes sell for less than a year ago" : "Homes sell for more than a year ago",
      text:
        `From ${sameHome.window}, Ontario homes sold for ${pct1(sameHome.pct)} ${sameHome.pct < 0 ? "less" : "more"} than similar homes in the same areas a year earlier.` +
        (sameHome.condoAptPct != null && sameHome.detachedPct != null
          ? ` Condo apartments: ${signedPct(sameHome.condoAptPct)}; detached houses: ${signedPct(sameHome.detachedPct)}.`
          : "") +
        (easing ? ` The drop is getting smaller: ${signedPct(worst!.pct)} in ${worst!.label}, ${signedPct(last.pct)} in ${last.label}.` : ""),
    });
  }
  if (combined?.underAskPct != null) {
    findings.push({
      id: "room",
      audience: "Buyers",
      title: "Buyers have room to negotiate",
      text:
        `In the last 12 months, ${pct0(combined.underAskPct)} of homes sold in the ${combined.cities} cities in this report sold for less than their first asking price.` +
        (combined.cutPct != null && combined.forSale ? ` Of the ${count(combined.forSale)} homes for sale there now, ${pct0(combined.cutPct)} have cut their price.` : ""),
    });
  }
  if (combined) {
    const ranked = cities.filter((c) => c.salesYoYPct != null).sort((x, y) => (y.salesYoYPct as number) - (x.salesYoYPct as number));
    const top = ranked[0];
    const low = ranked[ranked.length - 1];
    findings.push({
      id: "sales",
      audience: "Sellers",
      title: combined.salesYoYPct >= 0 ? "More homes are selling" : "Fewer homes are selling",
      text:
        `${count(combined.sales3m)} homes sold in the ${combined.cities} cities in this report from ${span}, ${pct0(combined.salesYoYPct)} ${combined.salesYoYPct >= 0 ? "more" : "fewer"} than in the same months a year earlier.` +
        (top && low && top !== low ? ` The change ranged from ${signedPct(top.salesYoYPct!, 0)} in ${top.city} to ${signedPct(low.salesYoYPct!, 0)} in ${low.city}.` : ""),
    });
  }
  {
    const priced = cities.filter((c) => c.priceYoYPct != null);
    const down = priced.filter((c) => (c.priceYoYPct as number) < 0);
    if (priced.length >= 3) {
      const sorted = [...priced].sort((x, y) => (x.priceYoYPct as number) - (y.priceYoYPct as number));
      const most = sorted[0];
      const least = sorted[sorted.length - 1];
      findings.push({
        id: "city_prices",
        audience: "Sellers",
        title: `The median price fell in ${down.length} of ${priced.length} cities`,
        text:
          `From ${span}, the median sale price was lower than a year earlier in ${down.length} of ${priced.length} cities.` +
          ` The largest drop was in ${most.city} (${signedPct(most.priceYoYPct!)}, to ${usdK(most.medianPrice!)}); ` +
          `${least.priceYoYPct! >= 0 ? `${least.city} rose ${pct1(least.priceYoYPct!)}` : `the smallest was in ${least.city} (${signedPct(least.priceYoYPct!)})`}. Medians move with the mix of homes sold.`,
      });
    }
  }
  if (pos && pos.prevSharePct != null) {
    findings.push({
      id: "power_of_sale",
      audience: "Owners",
      title: pos.sharePct >= pos.prevSharePct ? "More sales are power of sale" : "Fewer sales are power of sale",
      text: `From ${pos.from} to ${pos.to}, ${count(pos.pos)} of ${count(pos.sales)} Ontario home sales (${pos.sharePct.toFixed(2)}%) were power of sale, ${pos.sharePct >= pos.prevSharePct ? "up" : "down"} from ${pos.prevSharePct.toFixed(2)}% a year earlier. That is still a small share of the market.`,
    });
  }
  if (findings.length < 3) return null;

  const summary = findings
    .slice(0, 2)
    .map((f) => f.text.split(/(?<=\.)\s+/)[0])
    .join(" ");

  return {
    edition,
    label: editionLabel(edition),
    title: reportTitle(edition),
    publishedAt: inp.publishedAt,
    dataAsOf: board.dataAsOf,
    span,
    lastMonth: lastFull,
    summary,
    findings,
    sameHome,
    combined,
    pos,
    cities,
    forecasts: inp.forecasts,
  };
}
