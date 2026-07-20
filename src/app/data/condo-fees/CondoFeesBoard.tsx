"use client";

import { Readout, ReadoutCell } from "@/components/daylight/primitives";
import { RankingTable, type RankingColumn } from "@/components/data/RankingTable";
import type { CondoAreaRow } from "@/lib/data/condoFeeBoard";
import type { TrendBand } from "@/lib/condo/feeStability";

const DASH = "—";

const BAND_STYLE: Record<TrendBand, string> = {
  Stable: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  Moderate: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  Rising: "border-orange-500/40 bg-orange-500/15 text-orange-700 dark:text-orange-400",
  Steep: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

function BandChip({ band }: { band: TrendBand }) {
  return (
    <span
      className={`terminal-font inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${BAND_STYLE[band]}`}
    >
      {band}
    </span>
  );
}

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

const columns: RankingColumn<CondoAreaRow>[] = [
  {
    key: "area",
    label: "Neighbourhood",
    align: "left",
    sortValue: (r) => r.area,
    render: (r) => (
      <div className="min-w-0">
        <div className="truncate font-semibold">{r.area}</div>
        {r.city && <div className="truncate text-[11px] text-muted-foreground">{r.city}</div>}
      </div>
    ),
  },
  {
    key: "annualPct",
    label: "Fee Trend / yr",
    align: "right",
    hint: "Median annualized change in maintenance fee per sqft across the area's buildings",
    sortValue: (r) => r.annualPct,
    render: (r) => (
      <span
        className={`font-semibold ${
          r.annualPct > 6
            ? "text-[color:var(--dt-down)] dark:text-rose-400"
            : r.annualPct > 3
              ? "text-[color:var(--dt-warn)] dark:text-amber-400"
              : "text-[color:var(--dt-up)] dark:text-emerald-400"
        }`}
      >
        {signed(r.annualPct)}
      </span>
    ),
  },
  {
    key: "band",
    label: "Band",
    align: "left",
    sortValue: (r) => r.annualPct,
    render: (r) => <BandChip band={r.band} />,
  },
  {
    key: "spread",
    label: "Typical Range",
    align: "right",
    hint: "25th–75th percentile of the area's building trends",
    sortValue: (r) => r.p75AnnualPct,
    render: (r) =>
      r.p25AnnualPct == null || r.p75AnnualPct == null
        ? DASH
        : `${signed(r.p25AnnualPct)} to ${signed(r.p75AnnualPct)}`,
  },
  {
    key: "medianPsf",
    label: "Fee $/sqft",
    align: "right",
    hint: "Current typical monthly maintenance fee per square foot",
    sortValue: (r) => r.medianPsf,
    render: (r) => (r.medianPsf == null ? DASH : `$${r.medianPsf.toFixed(2)}`),
  },
  {
    key: "buildingCount",
    label: "Buildings",
    align: "right",
    sortValue: (r) => r.buildingCount,
    render: (r) => r.buildingCount.toLocaleString(),
  },
];

const GRID =
  "minmax(150px,1.6fr) minmax(96px,0.9fr) minmax(84px,0.7fr) minmax(132px,1.1fr) minmax(84px,0.8fr) minmax(78px,0.7fr)";

export function CondoFeesBoard({ rows, embed = false }: { rows: CondoAreaRow[]; embed?: boolean }) {
  const steepest = rows[0];
  const buildings = rows.reduce((s, r) => s + r.buildingCount, 0);
  const sorted = [...rows].map((r) => r.annualPct).sort((a, b) => a - b);
  const medianTrend = sorted.length
    ? sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : null;

  return (
    <div className="space-y-5">
      {!embed && (
        <Readout cols={3}>
          <ReadoutCell
            label="Typical area"
            value={medianTrend == null ? DASH : `${signed(medianTrend)}/yr`}
            sub={`across ${rows.length} neighbourhoods`}
          />
          <ReadoutCell
            label="Fastest rising"
            value={steepest ? steepest.area : DASH}
            tone="down"
            sub={steepest ? `${signed(steepest.annualPct)}/yr` : undefined}
          />
          <ReadoutCell label="Buildings tracked" value={buildings.toLocaleString()} sub="with enough sales to trend" />
        </Readout>
      )}
      <RankingTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => `${r.city}|${r.area}`}
        gridTemplate={GRID}
        initialSortKey="annualPct"
        initialSortDir="desc"
        minWidth={760}
      />
    </div>
  );
}
