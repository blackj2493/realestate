"use client";

/**
 * Mobile/tablet market grid — the interactive replacement for the two stacked 7-column
 * tables (`MarketGridCard`) below `lg`. The full beds × type matrix side-scrolls on a
 * phone and the sell+rent pair stacks to ~2 screens of scroll (owner report 2026-07-29),
 * so here we collapse it:
 *   - a Sold/Leased (or For sale/For rent) toggle shows ONE matrix at a time;
 *   - a bedroom chip row collapses the grid to a single column — a short list of just the
 *     types that traded, sorted by sample size, with a price-comparison bar and the sell
 *     middle-50% band;
 *   - "All" restores every type with its populated sizes inline (the fuller picture).
 * Opens on the most-sampled bedroom so the answer is there before any tap. Desktop
 * (`lg:block`) keeps MarketGridCard's aligned tables for cross-bed comparison.
 *
 * Formatting + copy mirror MarketGridCard exactly (medians are full dollars). VOW gate is
 * upstream: anon callers pass asking matrices + showSignInNudge; no gated value is here.
 */

import { useState } from "react";
import { CircleDollarSign, KeyRound } from "lucide-react";
import SignInLink from "@/components/auth/SignInLink";
import { IN_HOME_UNIT_LABEL, type AskingMatrix } from "@/lib/address/nearbyForSale";

/** Compact money for sale prices: $620k, $1.24M. */
const fmtPrice = (n: number) => {
  if (n >= 999_500) {
    const m = n / 1_000_000;
    return `$${(m >= 10 ? m.toFixed(1) : m.toFixed(2)).replace(/\.?0+$/, "")}M`;
  }
  return `$${Math.round(n / 1000)}k`;
};
const fmtRent = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const bedLabel = (b: number) => (b === 0 ? "Studio" : b >= 6 ? "6+ bd" : `${b} bd`);

/** Cells at/above this kept-sample size get the flavor tint (matches MarketGridCard). */
const DENSE_N = 5;

type Flavor = "sell" | "rent";
export interface MobileGrid {
  matrix: AskingMatrix;
  radiusKm: number;
  /** true = ACTUAL close prices (consumer/VOW); false = live asking prices (public). */
  actual: boolean;
}

const FLAVOR = {
  sell: {
    Icon: CircleDollarSign,
    chipBox: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    accentText: "text-emerald-700 dark:text-emerald-400",
    active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    tint: "bg-emerald-500/[0.06]",
    bar: "bg-emerald-500/80",
    barTrack: "bg-emerald-500/10",
  },
  rent: {
    Icon: KeyRound,
    chipBox: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
    accentText: "text-cyan-700 dark:text-cyan-400",
    active: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
    tint: "bg-cyan-500/[0.06]",
    bar: "bg-cyan-500/80",
    barTrack: "bg-cyan-500/10",
  },
} as const;

/** Total kept samples in one bed column (index into bedCols/cells). */
function bedTotal(m: AskingMatrix, i: number): number {
  return m.rows.reduce((s, r) => s + (r.cells[i]?.median != null ? r.cells[i].count : 0), 0);
}
/** Index of the bed column with the most samples — the view we open on. */
function busiestBed(m: AskingMatrix): number {
  let best = 0;
  let bn = -1;
  m.bedCols.forEach((_, i) => {
    const n = bedTotal(m, i);
    if (n > bn) {
      bn = n;
      best = i;
    }
  });
  return best;
}

export default function MarketGridsMobile({
  sell,
  rent,
  salesFirst = true,
  showSignInNudge = false,
}: {
  sell: MobileGrid | null;
  rent: MobileGrid | null;
  salesFirst?: boolean;
  showSignInNudge?: boolean;
}) {
  // Available flavors in display order; the toggle only appears when both have data.
  const order: Flavor[] = salesFirst ? ["sell", "rent"] : ["rent", "sell"];
  const flavors = order.filter((f) => (f === "sell" ? sell : rent));

  const [flavor, setFlavor] = useState<Flavor>(flavors[0] ?? "sell");
  const active = (flavor === "sell" ? sell : rent) ?? sell ?? rent;
  // bed = index into bedCols; null = the "All" overview.
  const [bed, setBed] = useState<number | null>(() => (active ? busiestBed(active.matrix) : null));

  if (!active) return null;

  const chooseFlavor = (f: Flavor) => {
    const g = f === "sell" ? sell : rent;
    if (!g) return;
    setFlavor(f);
    setBed(busiestBed(g.matrix));
  };

  const sell_ = flavor === "sell";
  const { Icon, chipBox, accentText, active: activeChip, tint, bar, barTrack } = FLAVOR[flavor];
  const fmt = sell_ ? fmtPrice : fmtRent;
  const { matrix, radiusKm, actual } = active;

  const title = sell_
    ? actual
      ? "What homes sell for here"
      : "Typical asking prices nearby"
    : actual
      ? "What homes rent for here"
      : "Typical rents nearby";
  const meta = sell_
    ? actual
      ? `${matrix.sample} sales · ~6 mo · ${radiusKm} km`
      : `${matrix.sample} live listings · ${radiusKm} km`
    : actual
      ? `${matrix.sample} leases · ~6 mo · ${radiusKm} km`
      : `${matrix.sample} live rentals · ${radiusKm} km`;
  const unit = sell_ ? (actual ? "closed sale" : "live listing") : actual ? "signed lease" : "live rental";
  const verb = sell_ ? (actual ? "sold" : "listed") : actual ? "leased" : "listed";

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card/40">
      <div className={`h-0.5 bg-gradient-to-r ${sell_ ? "from-emerald-500/70" : "from-cyan-500/70"} to-transparent`} />

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-foreground">
          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${chipBox}`}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          {title}
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground">{meta}</span>
      </div>

      {/* Sold | Leased (or For sale | For rent) — only when both matrices exist.
          Selected state is surface-based in LIGHT (a white pill lifted off the grey track
          by its shadow) but TINTED in DARK: there, `bg-card` (slate-900) is actually DARKER
          than the `bg-muted/40` track (slate-800) and `shadow-sm` is invisible on a dark
          ground, so the pill read as a barely-there depression and the two tabs were hard
          to tell apart (owner report 2026-08-04). Dark uses the same accent tint the bed
          chips below already use (FLAVOR.active), plus an inset ring: unlike an inactive
          bed chip, an inactive TAB has no box of its own, so the selected one needs a
          crisp edge and not just a fill to read as selected. Light is untouched. */}
      {flavors.length > 1 && (
        <div className="mx-4 mt-3 flex gap-1 rounded-lg border border-border bg-muted/40 p-1" role="tablist" aria-label="Transaction">
          {flavors.map((f) => {
            const on = f === flavor;
            const g = f === "sell" ? sell : rent;
            const label = f === "sell" ? (g?.actual ? "Sold" : "For sale") : g?.actual ? "Leased" : "For rent";
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => chooseFlavor(f)}
                className={`flex-1 rounded-md px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${
                  on
                    ? f === "sell"
                      ? "bg-card text-emerald-700 shadow-sm dark:bg-emerald-500/20 dark:text-emerald-300 dark:shadow-none dark:ring-1 dark:ring-inset dark:ring-emerald-400/35"
                      : "bg-card text-cyan-700 shadow-sm dark:bg-cyan-500/20 dark:text-cyan-300 dark:shadow-none dark:ring-1 dark:ring-inset dark:ring-cyan-400/35"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Bedroom chips — All + one per populated bed column. */}
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-1 pt-3" role="tablist" aria-label="Bedrooms">
        <BedChip label="All" on={bed === null} activeChip={activeChip} onClick={() => setBed(null)} />
        {matrix.bedCols.map((b, i) => {
          const n = bedTotal(matrix, i);
          if (!n) return null;
          return (
            <BedChip key={b} label={bedLabel(b)} count={n} on={bed === i} activeChip={activeChip} accentText={accentText} onClick={() => setBed(i)} />
          );
        })}
      </div>

      {bed === null ? (
        /* ── All: every type with its populated sizes inline ── */
        <div className="px-2 pb-1">
          {matrix.rows.map((row) => {
            const inHome = row.label === IN_HOME_UNIT_LABEL;
            const cells = matrix.bedCols
              .map((b, i) => ({ b, cell: row.cells[i] }))
              .filter((x) => x.cell && x.cell.median != null);
            if (cells.length === 0) return null;
            return (
              <div key={row.label} className="border-t border-border px-2 py-3 first:border-t-0">
                <p className={`mb-2 text-[13px] ${inHome ? "text-muted-foreground" : "text-foreground"}`}>{row.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {cells.map(({ b, cell }) => {
                    const dense = cell.count >= DENSE_N && !inHome;
                    return (
                      <span key={b} title={`${cell.count} ${unit}${cell.count === 1 ? "" : "s"}`} className={`rounded-md border border-border px-2 py-1 ${dense ? tint : ""}`}>
                        <span className="block font-mono text-[8.5px] font-medium uppercase tracking-wide text-muted-foreground">{bedLabel(b)}</span>
                        <span className={`font-mono text-[13px] font-semibold tabular-nums ${inHome ? "text-muted-foreground" : "text-foreground"}`}>{fmt(cell.median as number)}</span>
                        <span className="ml-1 font-mono text-[9px] text-muted-foreground">×{cell.count}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── One bedroom: a ranked list of the types that traded ── */
        (() => {
          const rows = matrix.rows
            .map((row) => ({ row, cell: row.cells[bed] }))
            .filter((x) => x.cell && x.cell.median != null)
            .sort((a, b2) => {
              const am = a.row.label === IN_HOME_UNIT_LABEL ? 1 : 0;
              const bm = b2.row.label === IN_HOME_UNIT_LABEL ? 1 : 0;
              return am - bm || (b2.cell!.count - a.cell!.count);
            });
          if (rows.length === 0) {
            return (
              <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                No {bedLabel(matrix.bedCols[bed]).toLowerCase()} {unit}s within {radiusKm} km.
              </p>
            );
          }
          const max = Math.max(...rows.filter((r) => r.row.label !== IN_HOME_UNIT_LABEL).map((r) => r.cell!.median as number), 1);
          return (
            <div className="px-2 pb-1">
              {rows.map(({ row, cell }) => {
                const inHome = row.label === IN_HOME_UNIT_LABEL;
                const c = cell!;
                const dense = c.count >= DENSE_N && !inHome;
                const hasRange = sell_ && c.p25 != null && c.p75 != null && c.p25 < c.p75;
                const width = Math.max(8, Math.round(((c.median as number) / max) * 100));
                return (
                  <div key={row.label} className={`grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1.5 rounded-lg border-t border-border px-3 py-3 first:border-t-0 ${dense ? tint : ""}`}>
                    <span className={`text-sm ${inHome ? "text-muted-foreground" : "text-foreground"}`}>{row.label}</span>
                    <span className={`text-right font-mono text-[17px] font-bold tabular-nums ${inHome ? "text-muted-foreground" : accentText}`}>{fmt(c.median as number)}</span>
                    <div className={`col-span-2 h-1 overflow-hidden rounded-full ${barTrack}`}>
                      <i className={`block h-full rounded-full ${bar} ${inHome ? "opacity-40" : ""}`} style={{ width: `${width}%` }} />
                    </div>
                    <div className="col-span-2 flex items-center justify-between gap-3 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                      <span>{hasRange ? `${fmtPrice(c.p25 as number)}–${fmtPrice(c.p75 as number)}` : " "}</span>
                      <span className="text-muted-foreground/70">×{c.count} {verb}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()
      )}

      <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
        {sell_
          ? actual
            ? "Median price homes actually sold for; the small band is the middle 50% of those sales (×n = closed sales). Sold data via TRREB VOW — for your personal, non-commercial use."
            : "Median asking price of live for-sale listings; the small band is the middle 50% (×n = listings) — not an appraisal."
          : actual
            ? "Median price homes actually leased for (×n = signed leases). Sold data via TRREB VOW — for your personal, non-commercial use."
            : "Median asking rent of live rental listings (×n = listings) — not a rent appraisal."}
      </p>

      {showSignInNudge && !actual && (
        <SignInLink className={`block border-t border-border px-4 py-2 text-xs font-medium hover:bg-muted/40 ${accentText}`}>
          {sell_ ? "See what homes here actually sold for — sign in free →" : "See what homes here actually leased for — sign in free →"}
        </SignInLink>
      )}
    </section>
  );
}

function BedChip({
  label,
  count,
  on,
  activeChip,
  accentText,
  onClick,
}: {
  label: string;
  count?: number;
  on: boolean;
  activeChip: string;
  accentText?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`flex-none rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${
        on ? `border-transparent ${activeChip}` : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      {count != null && <span className={`ml-1.5 text-[9px] font-medium ${on ? accentText ?? "" : "text-muted-foreground/60"}`}>×{count}</span>}
    </button>
  );
}
