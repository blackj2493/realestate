"use client";

import { Readout, ReadoutCell } from "@/components/daylight/primitives";
import { RankingTable, type RankingColumn } from "@/components/data/RankingTable";
import { fmtPercent } from "@/lib/format";
import type { MarketRow } from "@/lib/data/marketBoard";

const DASH = "—";

/** Public-facing labels: hot = seller's, cold = buyer's. Colours mirror the TempChip. */
const TEMP_MAP: Record<"hot" | "balanced" | "cold", { label: string; cls: string; rank: number }> = {
  hot: { label: "Seller's", cls: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-400", rank: 3 },
  balanced: { label: "Balanced", cls: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400", rank: 2 },
  cold: { label: "Buyer's", cls: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-400", rank: 1 },
};

function MarketType({ t }: { t: MarketRow["temperature"] }) {
  if (!t) return <span className="text-muted-foreground">{DASH}</span>;
  const m = TEMP_MAP[t];
  return (
    <span className={`terminal-font inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${m.cls}`}>
      {m.label}
    </span>
  );
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
    key: "temperature",
    label: "Market Type",
    align: "left",
    hint: "Seller's / balanced / buyer's — from sold-to-list ratio and months of supply",
    sortValue: (r) => (r.temperature ? TEMP_MAP[r.temperature].rank : null),
    render: (r) => <MarketType t={r.temperature} />,
  },
  {
    key: "monthsOfSupply",
    label: "Months of Supply",
    align: "right",
    hint: "How many months to sell all active inventory at the current sales pace — lower is tighter",
    sortValue: (r) => r.monthsOfSupply,
    render: (r) => (r.monthsOfSupply == null ? DASH : `${r.monthsOfSupply.toFixed(1)} mo`),
  },
  {
    key: "soldToListPct",
    label: "Sold / List",
    align: "right",
    hint: "Sale price as a percent of asking — over 100% means bidding above ask",
    sortValue: (r) => r.soldToListPct,
    render: (r) =>
      r.soldToListPct == null ? (
        DASH
      ) : (
        <span className={r.soldToListPct >= 100 ? "text-emerald-700 dark:text-emerald-400" : undefined}>
          {fmtPercent(r.soldToListPct)}
        </span>
      ),
  },
  {
    key: "sellThroughPct",
    label: "Sell-through",
    align: "right",
    hint: "Share of listings that actually sold (vs. withdrawn) over 12 months",
    sortValue: (r) => r.sellThroughPct,
    render: (r) => (r.sellThroughPct == null ? DASH : fmtPercent(r.sellThroughPct, 0)),
  },
];

const GRID =
  "minmax(104px,1.2fr) minmax(96px,0.9fr) minmax(112px,1fr) minmax(84px,0.8fr) minmax(96px,0.9fr)";

export function MarketTemperatureBoard({ rows, embed = false }: { rows: MarketRow[]; embed?: boolean }) {
  const scored = rows.filter((r) => r.temperature != null);
  const sellers = scored.filter((r) => r.temperature === "hot");
  const buyers = scored.filter((r) => r.temperature === "cold");
  const balanced = scored.filter((r) => r.temperature === "balanced");
  const toronto = rows.find((r) => r.region === "Toronto");

  const names = (list: MarketRow[]) => (list.length ? list.map((r) => r.region).join(", ") : "none");

  return (
    <div className="space-y-5">
      {!embed && (
        <Readout cols={3}>
          <ReadoutCell label="Seller's markets" value={String(sellers.length)} tone="down" sub={names(sellers)} />
          <ReadoutCell
            label="Toronto"
            value={toronto?.temperature ? TEMP_MAP[toronto.temperature].label : DASH}
            sub={
              toronto?.monthsOfSupply != null && toronto?.soldToListPct != null
                ? `${toronto.monthsOfSupply.toFixed(1)} mo · ${fmtPercent(toronto.soldToListPct)} SP/LP`
                : undefined
            }
          />
          <ReadoutCell label="Buyer's markets" value={String(buyers.length)} tone="sig" sub={names(buyers)} />
        </Readout>
      )}
      {!embed && balanced.length > 0 && (
        <p className="text-xs text-muted-foreground">
          The remaining {balanced.length} markets are balanced. Sorted by sold-to-list ratio — the sharpest
          read on which way each market leans.
        </p>
      )}
      <RankingTable
        columns={columns}
        rows={scored}
        getRowKey={(r) => r.region}
        gridTemplate={GRID}
        initialSortKey="soldToListPct"
        initialSortDir="desc"
        minWidth={620}
        isFeatured={(r) => r.region === "Toronto"}
      />
    </div>
  );
}
