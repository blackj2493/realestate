"use client";

import { useMemo, useState } from "react";
import { RankingTable, type RankingColumn } from "@/components/data/RankingTable";
import { THIN_SAMPLE, type RentGroup, type RentRow } from "@/lib/data/rentBoard";

const DASH = "—";
const money = (v: number) => `$${v.toLocaleString("en-CA")}`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

const columns: RankingColumn<RentRow>[] = [
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
    key: "medianRent",
    label: "Median Rent",
    align: "right",
    hint: "Median price the lease actually closed at — not the asking rent",
    sortValue: (r) => r.medianRent,
    render: (r) => <span className="font-semibold tabular-nums">{money(r.medianRent)}</span>,
  },
  {
    key: "medianBedrooms",
    label: "Typical Size",
    align: "right",
    // Without this the median is uninterpretable: a $2,800 median means something very
    // different for a 4-bed house than a 1-bed condo.
    hint: "Median bedroom count behind that figure",
    sortValue: (r) => r.medianBedrooms,
    render: (r) =>
      r.medianBedrooms == null ? (
        <span className="text-muted-foreground">{DASH}</span>
      ) : (
        <span className="tabular-nums">{r.medianBedrooms.toFixed(1)} bd</span>
      ),
  },
  {
    key: "yoyPct",
    label: "vs Last Year",
    align: "right",
    hint: "Change against the same 12-month window a year earlier. Blank where either period was too thin to support a percentage.",
    sortValue: (r) => r.yoyPct,
    render: (r) =>
      r.yoyPct == null ? (
        <span className="text-muted-foreground" title="Not enough history yet for a reliable comparison">
          {DASH}
        </span>
      ) : (
        <span
          className={`font-semibold tabular-nums ${
            r.yoyPct > 0
              ? "text-[color:var(--dt-down)] dark:text-rose-400"
              : r.yoyPct < 0
                ? "text-[color:var(--dt-up)] dark:text-emerald-400"
                : ""
          }`}
        >
          {signed(r.yoyPct)}
        </span>
      ),
  },
  {
    key: "spread",
    label: "Typical Range",
    align: "right",
    hint: "25th–75th percentile of closed rents in the area",
    sortValue: (r) => r.p75Rent,
    render: (r) =>
      r.p25Rent == null || r.p75Rent == null ? (
        <span className="text-muted-foreground">{DASH}</span>
      ) : (
        <span className="tabular-nums text-muted-foreground">
          {money(r.p25Rent)}–{money(r.p75Rent)}
        </span>
      ),
  },
  {
    key: "sampleCount",
    label: "Leases",
    align: "right",
    hint: "Closed leases behind the figure over the last 12 months",
    sortValue: (r) => r.sampleCount,
    // A thin sample is shown WITH its count rather than hidden or dashed — the reader can
    // then judge it. Suppressing thin rows entirely would quietly erase small towns.
    render: (r) => (
      <span
        className={`tabular-nums ${r.sampleCount < THIN_SAMPLE ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
        title={r.sampleCount < THIN_SAMPLE ? "Thin sample — treat as indicative only" : undefined}
      >
        ×{r.sampleCount}
      </span>
    ),
  },
];

const TABS: { key: RentGroup; label: string; note: string }[] = [
  {
    key: "House",
    label: "Houses",
    note: "Detached, semi, townhouse, duplex and multiplex. No other Canadian source publishes this — TRREB's rental report covers condo apartments only.",
  },
  {
    key: "Condo",
    label: "Condos",
    note: "Condo apartments, condo townhouses and co-ops. TRREB publishes a regional quarterly figure; this is by neighbourhood, nightly.",
  },
];

export function RentsBoard({ rows }: { rows: RentRow[] }) {
  // Houses first, deliberately: it is the half nobody else has.
  const [group, setGroup] = useState<RentGroup>("House");

  const shown = useMemo(() => rows.filter((r) => r.group === group), [rows, group]);
  const active = TABS.find((t) => t.key === group)!;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => {
          const n = rows.filter((r) => r.group === t.key).length;
          const on = t.key === group;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setGroup(t.key)}
              aria-pressed={on}
              className={`terminal-font rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                on
                  ? "border-cyan-600/50 bg-cyan-600/15 text-cyan-700 dark:text-cyan-300"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              <span className="ml-1.5 opacity-60">{n}</span>
            </button>
          );
        })}
      </div>

      <p className="mb-4 text-xs leading-relaxed text-muted-foreground sm:text-sm">{active.note}</p>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          No neighbourhoods currently have enough closed leases to report.
        </p>
      ) : (
        <RankingTable
          columns={columns}
          rows={shown}
          getRowKey={(r) => `${r.city}|${r.area}|${r.group}`}
          gridTemplate="minmax(160px,1.6fr) 110px 100px 110px 150px 90px"
          initialSortKey="sampleCount"
          initialSortDir="desc"
          minWidth={780}
        />
      )}
    </div>
  );
}
