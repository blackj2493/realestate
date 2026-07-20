"use client";

import { Readout, ReadoutCell } from "@/components/daylight/primitives";
import { RankingTable, type RankingColumn } from "@/components/data/RankingTable";
import { YoY, Sparkline } from "@/components/dashboard/metricViz";
import { fmtCompact, fmtCurrency, fmtPercent } from "@/lib/format";
import type { MarketRow } from "@/lib/data/marketBoard";

const DASH = "—";

const columns: RankingColumn<MarketRow>[] = [
  {
    key: "region",
    label: "Market",
    align: "left",
    sortValue: (r) => r.region,
    render: (r) => <span className="font-semibold">{r.region}</span>,
  },
  {
    key: "medianPrice",
    label: "Median Sold",
    align: "right",
    hint: "Median sold price, most recent month",
    sortValue: (r) => r.medianPrice,
    render: (r) => (
      <span className="font-semibold">{r.medianPrice == null ? DASH : fmtCompact(r.medianPrice)}</span>
    ),
  },
  {
    key: "avgPrice",
    label: "Average",
    align: "right",
    hint: "Mean sold price (aligns with TRREB/CREA headline averages)",
    sortValue: (r) => r.avgPrice,
    render: (r) => (r.avgPrice == null ? DASH : fmtCompact(r.avgPrice)),
  },
  {
    key: "yoyPct",
    label: "YoY",
    align: "right",
    hint: "Year-over-year change in median price (3-month smoothed)",
    sortValue: (r) => r.yoyPct,
    render: (r) => (r.yoyPct == null ? <span className="text-muted-foreground">{DASH}</span> : <YoY pct={r.yoyPct} />),
  },
  {
    key: "medianPpsf",
    label: "$ / Sqft",
    align: "right",
    sortValue: (r) => r.medianPpsf,
    render: (r) => (r.medianPpsf == null ? DASH : fmtCurrency(r.medianPpsf)),
  },
  {
    key: "soldToListPct",
    label: "Sold / List",
    align: "right",
    hint: "Sale price as a percent of asking — over 100% means selling above ask",
    sortValue: (r) => r.soldToListPct,
    render: (r) => (r.soldToListPct == null ? DASH : fmtPercent(r.soldToListPct)),
  },
  {
    key: "trend",
    label: "12-mo Trend",
    align: "right",
    render: (r) =>
      r.priceSeries.length >= 2 ? (
        <span className="inline-flex justify-end">
          <Sparkline data={r.priceSeries} />
        </span>
      ) : (
        DASH
      ),
  },
];

const GRID =
  "minmax(104px,1.3fr) minmax(92px,1fr) minmax(84px,0.9fr) minmax(92px,0.9fr) minmax(70px,0.7fr) minmax(84px,0.8fr) minmax(96px,0.9fr)";

export function PriceRankingsBoard({ rows, embed = false }: { rows: MarketRow[]; embed?: boolean }) {
  const priced = rows.filter((r) => r.medianPrice != null);
  const byMedian = [...priced].sort((a, b) => (b.medianPrice ?? 0) - (a.medianPrice ?? 0));
  const dearest = byMedian[0];
  const toronto = rows.find((r) => r.region === "Toronto");
  const byYoy = priced.filter((r) => r.yoyPct != null).sort((a, b) => (b.yoyPct ?? 0) - (a.yoyPct ?? 0));
  const strongest = byYoy[0];

  return (
    <div className="space-y-5">
      {!embed && (
        <Readout cols={3}>
          <ReadoutCell
            label="Priciest market"
            value={dearest ? dearest.region : DASH}
            sub={dearest?.medianPrice != null ? `${fmtCompact(dearest.medianPrice)} median` : undefined}
          />
          <ReadoutCell
            label="Toronto median"
            value={toronto?.medianPrice != null ? fmtCompact(toronto.medianPrice) : DASH}
            sub={toronto?.yoyPct != null ? <YoY pct={toronto.yoyPct} /> : undefined}
          />
          <ReadoutCell
            label="Strongest YoY"
            value={strongest ? strongest.region : DASH}
            tone={strongest && (strongest.yoyPct ?? 0) >= 0 ? "up" : "down"}
            sub={strongest?.yoyPct != null ? <YoY pct={strongest.yoyPct} /> : undefined}
          />
        </Readout>
      )}
      <RankingTable
        columns={columns}
        rows={priced}
        getRowKey={(r) => r.region}
        gridTemplate={GRID}
        initialSortKey="medianPrice"
        initialSortDir="desc"
        minWidth={720}
        isFeatured={(r) => r.region === "Toronto"}
      />
    </div>
  );
}
