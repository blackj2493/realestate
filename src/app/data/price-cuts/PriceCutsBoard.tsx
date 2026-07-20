"use client";

import { Readout, ReadoutCell } from "@/components/daylight/primitives";
import { RankingTable, type RankingColumn } from "@/components/data/RankingTable";
import { fmtPercent, fmtCompact } from "@/lib/format";
import type { MarketRow } from "@/lib/data/marketBoard";

const DASH = "—";
/** cutShare is a 0..1 ratio → percent. */
const pctShare = (v: number | null) => (v == null ? DASH : fmtPercent(v * 100));
/** medianCutPct is already a percent value (drop/(list+drop)×100). */
const pctVal = (v: number | null) => (v == null ? DASH : fmtPercent(v));

const columns: RankingColumn<MarketRow>[] = [
  {
    key: "region",
    label: "Market",
    align: "left",
    sortValue: (r) => r.region,
    render: (r) => <span className="font-semibold">{r.region}</span>,
  },
  {
    key: "cutShare",
    label: "% Cutting Price",
    align: "right",
    hint: "Share of active listings whose asking price is below their original list price",
    sortValue: (r) => r.cutShare,
    render: (r) => (
      <span className="font-semibold text-[color:var(--dt-down)] dark:text-rose-400">{pctShare(r.cutShare)}</span>
    ),
  },
  {
    key: "medianCutPct",
    label: "Median Cut",
    align: "right",
    hint: "Median size of the reduction, among listings that cut",
    sortValue: (r) => r.medianCutPct,
    render: (r) => pctVal(r.medianCutPct),
  },
  {
    key: "medianCutAmt",
    label: "Median $ Off",
    align: "right",
    sortValue: (r) => r.medianCutAmt,
    render: (r) => (r.medianCutAmt == null ? DASH : fmtCompact(r.medianCutAmt)),
  },
  {
    key: "cutCount",
    label: "Listings Cut",
    align: "right",
    sortValue: (r) => r.cutCount,
    render: (r) => (r.cutCount == null ? DASH : r.cutCount.toLocaleString()),
  },
  {
    key: "cutActive",
    label: "Active",
    align: "right",
    sortValue: (r) => r.cutActive,
    render: (r) => (r.cutActive == null ? DASH : r.cutActive.toLocaleString()),
  },
];

const GRID =
  "minmax(116px,1.4fr) minmax(104px,1fr) minmax(84px,0.9fr) minmax(92px,0.9fr) minmax(88px,0.9fr) minmax(72px,0.8fr)";

export function PriceCutsBoard({ rows, embed = false }: { rows: MarketRow[]; embed?: boolean }) {
  const withShare = rows.filter((r) => r.cutShare != null);
  const top = [...withShare].sort((a, b) => (b.cutShare ?? 0) - (a.cutShare ?? 0))[0];
  const totalCut = withShare.reduce((s, r) => s + (r.cutCount ?? 0), 0);
  const totalActive = withShare.reduce((s, r) => s + (r.cutActive ?? 0), 0);
  const gtaShare = totalActive > 0 ? totalCut / totalActive : null;
  const toronto = rows.find((r) => r.region === "Toronto");

  return (
    <div className="space-y-5">
      {!embed && (
        <Readout cols={3}>
          <ReadoutCell
            label="GTA cutting price"
            value={pctShare(gtaShare)}
            tone="down"
            sub={`${totalCut.toLocaleString()} of ${totalActive.toLocaleString()} active`}
          />
          <ReadoutCell
            label="Toronto"
            value={pctShare(toronto?.cutShare ?? null)}
            tone="down"
            sub={toronto?.medianCutPct != null ? `${pctVal(toronto.medianCutPct)} median cut` : undefined}
          />
          <ReadoutCell
            label="Sharpest market"
            value={top ? top.region : DASH}
            sub={top ? `${pctShare(top.cutShare)} cutting price` : undefined}
          />
        </Readout>
      )}
      <RankingTable
        columns={columns}
        rows={withShare}
        getRowKey={(r) => r.region}
        gridTemplate={GRID}
        initialSortKey="cutShare"
        initialSortDir="desc"
        minWidth={620}
        isFeatured={(r) => r.region === "Toronto"}
      />
    </div>
  );
}
