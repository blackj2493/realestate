"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Readout, ReadoutCell } from "@/components/daylight/primitives";
import { RankingTable, type RankingColumn } from "@/components/data/RankingTable";
import { fmtCompact, fmtCurrency, fmtPercent } from "@/lib/format";
import type { MarketRow } from "@/lib/data/marketBoard";

const DASH = "—";
const BEDS = [1, 2, 3, 4] as const;

interface Row {
  region: string;
  rent: number | null;
  price: number | null;
  grossYield: number | null;
  ptr: number | null; // price-to-rent = price / annual rent
}

function toRow(m: MarketRow, beds: number): Row {
  const rr = m.rentalRows.find((r) => r.beds === beds);
  const rent = rr?.typicalRent ?? null;
  const price = rr?.medianPrice ?? null;
  const ptr = rent != null && price != null && rent > 0 ? price / (rent * 12) : null;
  return { region: m.region, rent, price, grossYield: rr?.grossYieldPct ?? null, ptr };
}

const columns: RankingColumn<Row>[] = [
  {
    key: "region",
    label: "Market",
    align: "left",
    sortValue: (r) => r.region,
    render: (r) => <span className="font-semibold">{r.region}</span>,
  },
  {
    key: "rent",
    label: "Monthly Rent",
    align: "right",
    hint: "Typical asking rent for this bedroom count",
    sortValue: (r) => r.rent,
    render: (r) => (r.rent == null ? DASH : fmtCurrency(r.rent)),
  },
  {
    key: "price",
    label: "Median Price",
    align: "right",
    hint: "Median sold price for this bedroom count (trailing 12 months)",
    sortValue: (r) => r.price,
    render: (r) => (r.price == null ? DASH : fmtCompact(r.price)),
  },
  {
    key: "grossYield",
    label: "Gross Yield",
    align: "right",
    hint: "Annual rent ÷ price, before ownership costs — higher favours buying to rent out",
    sortValue: (r) => r.grossYield,
    render: (r) =>
      r.grossYield == null ? (
        DASH
      ) : (
        <span className="font-semibold text-[color:var(--dt-up)] dark:text-emerald-400">{fmtPercent(r.grossYield)}</span>
      ),
  },
  {
    key: "ptr",
    label: "Price-to-Rent",
    align: "right",
    hint: "Price ÷ annual rent. Under ~15 leans toward buying; over ~20 leans toward renting.",
    sortValue: (r) => r.ptr,
    render: (r) => (r.ptr == null ? DASH : r.ptr.toFixed(1)),
  },
];

const GRID =
  "minmax(104px,1.3fr) minmax(96px,1fr) minmax(88px,0.9fr) minmax(84px,0.9fr) minmax(100px,0.9fr)";

export function RentVsBuyBoard({ rows, embed = false }: { rows: MarketRow[]; embed?: boolean }) {
  const [beds, setBeds] = useState(2);
  const data = rows.map((m) => toRow(m, beds)).filter((r) => r.rent != null || r.grossYield != null);

  const withYield = data.filter((r) => r.grossYield != null);
  const best = [...withYield].sort((a, b) => (b.grossYield ?? 0) - (a.grossYield ?? 0))[0];
  const rentFavoured = [...data.filter((r) => r.ptr != null)].sort((a, b) => (b.ptr ?? 0) - (a.ptr ?? 0))[0];
  const toronto = data.find((r) => r.region === "Toronto");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="terminal-font text-xs uppercase tracking-wider text-muted-foreground">Bedrooms:</span>
        {BEDS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBeds(b)}
            className={cn(
              "terminal-font rounded border px-2.5 py-1 text-xs font-semibold transition-colors",
              b === beds
                ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {b} BR
          </button>
        ))}
      </div>

      {!embed && (
        <Readout cols={3}>
          <ReadoutCell
            label={`Highest yield (${beds}BR)`}
            value={best ? best.region : DASH}
            tone="up"
            sub={best?.grossYield != null ? `${fmtPercent(best.grossYield)} gross` : undefined}
          />
          <ReadoutCell
            label={`Toronto (${beds}BR)`}
            value={toronto?.grossYield != null ? fmtPercent(toronto.grossYield) : DASH}
            sub={toronto?.ptr != null ? `${toronto.ptr.toFixed(1)}× price-to-rent` : undefined}
          />
          <ReadoutCell
            label="Renting favoured most"
            value={rentFavoured ? rentFavoured.region : DASH}
            sub={rentFavoured?.ptr != null ? `${rentFavoured.ptr.toFixed(1)}× price-to-rent` : undefined}
          />
        </Readout>
      )}

      <RankingTable
        columns={columns}
        rows={data}
        getRowKey={(r) => r.region}
        gridTemplate={GRID}
        initialSortKey="grossYield"
        initialSortDir="desc"
        minWidth={620}
        isFeatured={(r) => r.region === "Toronto"}
      />
    </div>
  );
}
