import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getMarketBoard, type MarketRow } from "@/lib/data/marketBoard";
import { getCondoFeeBoard, type CondoAreaRow } from "@/lib/data/condoFeeBoard";
import { trackerBySlug } from "@/lib/data/trackers";
import { EmbedTable, type EmbedColumn } from "@/components/data/EmbedTable";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;
export const dynamicParams = true;

const FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tracker: string }>;
}): Promise<Metadata> {
  const { tracker } = await params;
  const def = trackerBySlug(tracker);
  // Embeds are duplicate views of the /data page — never indexed; canonical points home.
  return {
    title: def ? `${def.title} — PureProperty` : "PureProperty",
    robots: { index: false, follow: true },
    alternates: def ? { canonical: `${SITE_URL}/data/${tracker}` } : undefined,
  };
}

// ── formatting (local: the widget must not depend on app theme/format helpers) ──
const DASH = "—";
const pct = (n: number | null | undefined, d = 1) => (n == null ? DASH : `${n.toFixed(d)}%`);
const money0 = (n: number | null | undefined) =>
  n == null ? DASH : `$${Math.round(n).toLocaleString("en-CA")}`;
const compact = (n: number | null | undefined) =>
  n == null ? DASH : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;
const int = (n: number | null | undefined) => (n == null ? DASH : n.toLocaleString("en-CA"));
const signed = (n: number | null | undefined) =>
  n == null ? DASH : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;

const MARKET = (r: MarketRow) => r.region;

interface Widget {
  columns: EmbedColumn<unknown>[];
  rows: unknown[];
  getRowKey: (row: unknown) => string;
  caption?: string;
}

/** Build the neutral table config for a tracker; null → 404. */
async function buildWidget(slug: string): Promise<Widget | null> {
  const cols = <T,>(c: EmbedColumn<T>[]) => c as unknown as EmbedColumn<unknown>[];

  if (slug === "price-cuts") {
    const board = await getMarketBoard();
    const rows = board.rows
      .filter((r) => r.cutShare != null)
      .sort((a, b) => (b.cutShare ?? 0) - (a.cutShare ?? 0));
    return {
      rows,
      getRowKey: (r) => (r as MarketRow).region,
      caption: "Share of active listings whose asking price is below their original list price.",
      columns: cols<MarketRow>([
        { label: "Market", value: MARKET },
        { label: "% cutting price", align: "right", lead: true, value: (r) => pct((r.cutShare ?? 0) * 100) },
        { label: "Median cut", align: "right", value: (r) => pct(r.medianCutPct) },
        { label: "Median $ off", align: "right", value: (r) => compact(r.medianCutAmt) },
        { label: "Listings cut", align: "right", value: (r) => int(r.cutCount) },
        { label: "Active", align: "right", value: (r) => int(r.cutActive) },
      ]),
    };
  }

  if (slug === "price-rankings") {
    const board = await getMarketBoard();
    const rows = board.rows
      .filter((r) => r.medianPrice != null)
      .sort((a, b) => (b.medianPrice ?? 0) - (a.medianPrice ?? 0));
    return {
      rows,
      getRowKey: (r) => (r as MarketRow).region,
      caption: "Median and average sold price, most recent month. Year-over-year is 3-month smoothed.",
      columns: cols<MarketRow>([
        { label: "Market", value: MARKET },
        { label: "Median sold", align: "right", lead: true, value: (r) => money0(r.medianPrice) },
        { label: "Average", align: "right", value: (r) => money0(r.avgPrice) },
        { label: "YoY", align: "right", value: (r) => signed(r.yoyPct) },
        { label: "$/sqft", align: "right", value: (r) => money0(r.medianPpsf) },
        { label: "Sold/list", align: "right", value: (r) => pct(r.soldToListPct) },
      ]),
    };
  }

  if (slug === "days-on-market") {
    const board = await getMarketBoard();
    const rows = board.rows
      .filter((r) => r.soldMedianDom != null)
      .sort((a, b) => (a.soldMedianDom ?? 0) - (b.soldMedianDom ?? 0));
    return {
      rows,
      getRowKey: (r) => (r as MarketRow).region,
      caption: "Median days a recently-sold home spent on market, adjusted for relists.",
      columns: cols<MarketRow>([
        { label: "Market", value: MARKET },
        { label: "Days to sell", align: "right", lead: true, value: (r) => (r.soldMedianDom == null ? DASH : `${r.soldMedianDom}`) },
        {
          label: "Typical range",
          align: "right",
          value: (r) => (r.soldP25Dom == null || r.soldP75Dom == null ? DASH : `${r.soldP25Dom}–${r.soldP75Dom}`),
        },
        { label: "Active listing age", align: "right", value: (r) => (r.trueDom == null ? DASH : `${r.trueDom}`) },
      ]),
    };
  }

  if (slug === "market-temperature") {
    const board = await getMarketBoard();
    const LABEL: Record<string, string> = { hot: "Seller's", balanced: "Balanced", cold: "Buyer's" };
    const rows = board.rows
      .filter((r) => r.temperature != null)
      .sort((a, b) => (b.soldToListPct ?? 0) - (a.soldToListPct ?? 0));
    return {
      rows,
      getRowKey: (r) => (r as MarketRow).region,
      caption: "Market type is derived from sold-to-list ratio and months of supply.",
      columns: cols<MarketRow>([
        { label: "Market", value: MARKET },
        { label: "Market type", lead: true, value: (r) => (r.temperature ? LABEL[r.temperature] : DASH) },
        { label: "Months of supply", align: "right", value: (r) => (r.monthsOfSupply == null ? DASH : r.monthsOfSupply.toFixed(1)) },
        { label: "Sold/list", align: "right", value: (r) => pct(r.soldToListPct) },
        { label: "Sell-through", align: "right", value: (r) => pct(r.sellThroughPct, 0) },
      ]),
    };
  }

  if (slug === "rent-vs-buy") {
    const board = await getMarketBoard();
    // Two-bedroom is the comparable most publications quote.
    const rows = board.rows
      .map((r) => ({ region: r.region, rr: r.rentalRows.find((x) => x.beds === 2) }))
      .filter((x) => x.rr != null)
      .sort((a, b) => (b.rr?.grossYieldPct ?? 0) - (a.rr?.grossYieldPct ?? 0));
    type Row = (typeof rows)[number];
    return {
      rows,
      getRowKey: (r) => (r as Row).region,
      caption:
        "Two-bedroom homes. Gross yield is annual rent ÷ price, before mortgage interest, taxes and maintenance.",
      columns: cols<Row>([
        { label: "Market", value: (r) => r.region },
        { label: "Gross yield", align: "right", lead: true, value: (r) => pct(r.rr?.grossYieldPct, 2) },
        { label: "Monthly rent", align: "right", value: (r) => money0(r.rr?.typicalRent) },
        { label: "Median price", align: "right", value: (r) => money0(r.rr?.medianPrice) },
        {
          label: "Price-to-rent",
          align: "right",
          value: (r) =>
            r.rr?.typicalRent && r.rr?.medianPrice
              ? (r.rr.medianPrice / (r.rr.typicalRent * 12)).toFixed(1)
              : DASH,
        },
      ]),
    };
  }

  if (slug === "condo-fees") {
    const board = await getCondoFeeBoard();
    const rows = board.rows.slice(0, 25); // a widget, not the full table — link through for the rest
    return {
      rows,
      getRowKey: (r) => `${(r as CondoAreaRow).city}|${(r as CondoAreaRow).area}`,
      caption:
        "Median annualized change in maintenance fee per square foot across each neighbourhood's buildings. Long-run condo-fee inflation runs about 3% a year.",
      columns: cols<CondoAreaRow>([
        { label: "Neighbourhood", value: (r) => r.area },
        { label: "City", value: (r) => r.city || DASH },
        { label: "Fee trend / yr", align: "right", lead: true, value: (r) => signed(r.annualPct) },
        { label: "Fee $/sqft", align: "right", value: (r) => (r.medianPsf == null ? DASH : `$${r.medianPsf.toFixed(2)}`) },
        { label: "Buildings", align: "right", value: (r) => int(r.buildingCount) },
      ]),
    };
  }

  return null;
}

/** The "as of" date is a credibility signal for anyone citing the table. */
async function dataAsOf(slug: string): Promise<string | null> {
  const board = slug === "condo-fees" ? await getCondoFeeBoard() : await getMarketBoard();
  return board.dataAsOf
    ? new Date(board.dataAsOf).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })
    : null;
}

export default async function EmbedPage({ params }: { params: Promise<{ tracker: string }> }) {
  const { tracker } = await params;
  const def = trackerBySlug(tracker);
  if (!def || def.status !== "live") notFound();

  const widget = await buildWidget(tracker);
  if (!widget || widget.rows.length === 0) notFound();
  const asOf = await dataAsOf(tracker);

  const pageUrl = `${SITE_URL}/data/${tracker}`;
  const link: ReactNode = (
    // A REAL anchor, not just the iframe src: an iframe URL is not crawlable link equity.
    <a href={pageUrl} target="_blank" rel="noopener" style={{ color: "#0f766e", textDecoration: "underline" }}>
      {def.title} — PureProperty.ca
    </a>
  );

  return (
    <div style={{ background: "#ffffff", padding: 16, fontFamily: FONT, color: "#0f172a" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>{def.title}</h1>
        {asOf && <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>Data as of {asOf}</span>}
      </div>

      <EmbedTable columns={widget.columns} rows={widget.rows} getRowKey={widget.getRowKey} caption={widget.caption} />

      <p style={{ fontSize: 11, color: "#64748b", margin: "10px 0 0", lineHeight: 1.5 }}>
        Source: {link}. Live MLS® data, deemed reliable but not guaranteed accurate.
      </p>
    </div>
  );
}
