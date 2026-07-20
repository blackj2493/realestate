"use client";

import { Readout, ReadoutCell } from "@/components/daylight/primitives";
import { RankingTable, type RankingColumn } from "@/components/data/RankingTable";
import { fmtPercent } from "@/lib/format";
import type { MarketRow } from "@/lib/data/marketBoard";

const DASH = "—";
const days = (n: number | null) => (n == null ? DASH : `${n}d`);

/** Share of active listings that have sat 90+ days, from the DoM distribution buckets. */
function stale90(b: MarketRow["domBuckets"]): number | null {
  if (!b) return null;
  const total = b.d0_14 + b.d15_30 + b.d31_60 + b.d61_90 + b.d90plus;
  return total > 0 ? b.d90plus / total : null;
}

const columns: RankingColumn<MarketRow>[] = [
  {
    key: "region",
    label: "Market",
    align: "left",
    sortValue: (r) => r.region,
    render: (r) => <span className="font-semibold">{r.region}</span>,
  },
  {
    key: "soldMedianDom",
    label: "Median Days to Sell",
    align: "right",
    hint: "Median days a recently-sold home spent listed (relist-adjusted)",
    sortValue: (r) => r.soldMedianDom,
    render: (r) => (
      <span className="font-semibold text-[color:var(--dt-sig)] dark:text-cyan-400">{days(r.soldMedianDom)}</span>
    ),
  },
  {
    key: "range",
    label: "Fast → Slow (25–75%)",
    align: "right",
    hint: "25th to 75th percentile of days-to-sell",
    sortValue: (r) => r.soldP75Dom,
    render: (r) =>
      r.soldP25Dom == null || r.soldP75Dom == null ? DASH : `${r.soldP25Dom}–${r.soldP75Dom}d`,
  },
  {
    key: "activeAge",
    label: "Active Listing Age",
    align: "right",
    hint: "Median days the current active listings have been on market",
    sortValue: (r) => r.trueDom,
    render: (r) => days(r.trueDom),
  },
  {
    key: "stale90",
    label: "Sitting 90+ Days",
    align: "right",
    hint: "Share of active listings on market 90+ days",
    sortValue: (r) => stale90(r.domBuckets),
    render: (r) => {
      const s = stale90(r.domBuckets);
      return s == null ? DASH : (
        <span className="text-[color:var(--dt-warn)] dark:text-amber-400">{fmtPercent(s * 100)}</span>
      );
    },
  },
];

const GRID =
  "minmax(104px,1.3fr) minmax(112px,1.1fr) minmax(120px,1.1fr) minmax(104px,1fr) minmax(100px,1fr)";

export function DaysOnMarketBoard({ rows, embed = false }: { rows: MarketRow[]; embed?: boolean }) {
  const sellable = rows.filter((r) => r.soldMedianDom != null);
  const bySpeed = [...sellable].sort((a, b) => (a.soldMedianDom ?? 0) - (b.soldMedianDom ?? 0));
  const fastest = bySpeed[0];
  const slowest = bySpeed[bySpeed.length - 1];
  const toronto = rows.find((r) => r.region === "Toronto");

  return (
    <div className="space-y-5">
      {!embed && (
        <Readout cols={3}>
          <ReadoutCell
            label="Fastest market"
            value={fastest ? fastest.region : DASH}
            tone="sig"
            sub={fastest?.soldMedianDom != null ? `${fastest.soldMedianDom} days to sell` : undefined}
          />
          <ReadoutCell
            label="Toronto"
            value={toronto?.soldMedianDom != null ? `${toronto.soldMedianDom} days` : DASH}
            sub={
              toronto?.soldP25Dom != null && toronto?.soldP75Dom != null
                ? `${toronto.soldP25Dom}–${toronto.soldP75Dom}d typical`
                : undefined
            }
          />
          <ReadoutCell
            label="Slowest market"
            value={slowest ? slowest.region : DASH}
            sub={slowest?.soldMedianDom != null ? `${slowest.soldMedianDom} days to sell` : undefined}
          />
        </Readout>
      )}
      <RankingTable
        columns={columns}
        rows={sellable}
        getRowKey={(r) => r.region}
        gridTemplate={GRID}
        initialSortKey="soldMedianDom"
        initialSortDir="asc"
        minWidth={640}
        isFeatured={(r) => r.region === "Toronto"}
      />
    </div>
  );
}
