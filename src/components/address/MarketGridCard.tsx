/**
 * Shared beds × type market grid — the visual shell for BOTH stat cards
 * ("What homes sell for here" / "What homes rent for here"), redesigned for
 * at-a-glance separation (owner feedback 2026-07-24: the twin plain tables
 * stacked one after the other blurred together):
 *  - flavor accents: SELL = emerald (money) with a dollar icon, RENT = cyan
 *    with a key icon — accent bar + icon chip make each card recognizable
 *    before a single number is read;
 *  - ONE canonical row order (whole homes → condos → in-home units last) so
 *    the two stacked cards line up type-by-type for vertical comparison —
 *    previously each sorted by sample count, putting Detached first in one
 *    table and fourth in the other;
 *  - sticky Type column, so row labels survive the horizontal scroll;
 *  - well-sampled cells (≥5 kept points) carry a faint flavor tint — dense
 *    signal pops, lone-sample cells stay quiet; empty cells are a dim dash;
 *  - the in-home unit row renders muted: context, not a whole-home number.
 * Sell cells show the middle-50% band; rent cells stay median-only (audited
 * spreads run 4–11%, the band would add noise, not information).
 * Renders null on null matrix. Server component — flavor decides copy/format.
 */
import { CircleDollarSign, KeyRound } from "lucide-react";
import SignInLink from "@/components/auth/SignInLink";
import { IN_HOME_UNIT_LABEL, type AskingMatrix } from "@/lib/address/nearbyForSale";
import { bedKeyLabel } from "@/lib/listings/bedSplit";

/** Compact money for sale prices: $620k, $1.24M — full figures don't fit the grid. */
const fmtPrice = (n: number) => {
  if (n >= 999_500) {
    const m = n / 1_000_000;
    return `$${(m >= 10 ? m.toFixed(1) : m.toFixed(2)).replace(/\.?0+$/, "")}M`;
  }
  return `$${Math.round(n / 1000)}k`;
};

/** Full figure for monthly rents: $2,800. */
const fmtRent = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

/** Column headers come from the bed classifier so "1+1" and its label never drift. */
const bedLabel = bedKeyLabel;

/** Canonical display order — shared by both cards so stacked grids align. */
const TYPE_RANK = new Map<string, number>([
  ["Detached", 0],
  ["Link", 1],
  ["Semi-Detached", 2],
  ["Att/Row/Townhouse", 3],
  ["Duplex", 4],
  ["Triplex", 5],
  ["Fourplex", 6],
  ["Multiplex", 7],
  ["Condo Townhouse", 8],
  ["Common Element Condo", 9],
  ["Condo Apartment", 10],
  ["Co-op Apartment", 11],
  [IN_HOME_UNIT_LABEL, 99],
]);
const rank = (label: string) => TYPE_RANK.get(label) ?? 50;

/** Cells at/above this kept-sample size get the flavor tint (matches RANGE_MIN_N). */
const DENSE_N = 5;

const FLAVORS = {
  sell: {
    Icon: CircleDollarSign,
    chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    bar: "from-emerald-500/70",
    cellTint: "bg-emerald-500/[0.06]",
  },
  rent: {
    Icon: KeyRound,
    chip: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
    bar: "from-cyan-500/70",
    cellTint: "bg-cyan-500/[0.06]",
  },
} as const;

export default function MarketGridCard({
  matrix,
  radiusKm,
  flavor,
  actual,
  showSignInNudge = false,
}: {
  matrix: AskingMatrix | null;
  radiusKm: number;
  /** "sell" = sale prices (emerald), "rent" = monthly rents (cyan). */
  flavor: "sell" | "rent";
  /** true = ACTUAL close prices (consumer/VOW); false = live asking prices (public). */
  actual: boolean;
  /** Anonymous viewers: advertise the actual-closes upgrade under the asking grid. */
  showSignInNudge?: boolean;
}) {
  if (!matrix) return null;
  const sell = flavor === "sell";
  const { Icon, chip, bar, cellTint } = FLAVORS[flavor];
  const fmt = sell ? fmtPrice : fmtRent;
  const rows = [...matrix.rows].sort((a, b) => rank(a.label) - rank(b.label) || b.count - a.count);
  const title = sell
    ? actual
      ? "What homes sell for here"
      : "Typical asking prices nearby"
    : actual
      ? "What homes rent for here"
      : "Typical rents nearby";
  const meta = sell
    ? actual
      ? `${matrix.sample} sales · ~6 mo · ${radiusKm} km`
      : `${matrix.sample} live listings · ${radiusKm} km`
    : actual
      ? `${matrix.sample} leases · ~6 mo · ${radiusKm} km`
      : `${matrix.sample} live rentals · ${radiusKm} km`;
  const unit = sell ? (actual ? "closed sale" : "live listing") : actual ? "signed lease" : "live rental";
  return (
    // min-w-0 lets the card shrink inside any flex/grid parent so the wide table
    // scrolls inside its own overflow-x-auto container below (never the page body).
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card/40">
      <div className={`h-0.5 bg-gradient-to-r ${bar} to-transparent`} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-foreground">
          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${chip}`}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          {title}
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground">{meta}</span>
      </div>
      {/* Mobile (<sm): stacked type blocks with WRAPPED bed chips — only populated
          cells render, so the dash grid and the horizontal scroll disappear (owner
          feedback 2026-07-24: the wide table needed too much side-scrolling on
          phones). Desktop keeps the aligned table for cross-bed comparison. */}
      <div className="divide-y divide-border sm:hidden">
        {rows.map((row) => {
          const inHome = row.label === IN_HOME_UNIT_LABEL;
          return (
            <div key={row.label} className="px-4 py-3">
              <p className={`text-sm ${inHome ? "text-muted-foreground" : "text-foreground"}`}>{row.label}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {matrix.bedCols.map((b, i) => {
                  const cell = row.cells[i];
                  if (!cell || cell.median === null) return null;
                  const hasRange = sell && cell.p25 != null && cell.p75 != null && cell.p25 < cell.p75;
                  const dense = cell.count >= DENSE_N;
                  return (
                    <span
                      key={b}
                      title={`${cell.count} ${unit}${cell.count === 1 ? "" : "s"}`}
                      className={`rounded-md border border-border px-2 py-1 font-mono tabular-nums ${
                        dense && !inHome ? cellTint : ""
                      }`}
                    >
                      <span className="block text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                        {bedLabel(b)}
                      </span>
                      <span className={`text-sm font-semibold ${inHome ? "text-muted-foreground" : "text-foreground"}`}>
                        {fmt(cell.median)}
                      </span>
                      <span className="ml-1 text-[9px] text-muted-foreground">×{cell.count}</span>
                      {hasRange && (
                        <span className="block text-[9px] leading-tight text-muted-foreground">
                          {fmtPrice(cell.p25 as number)}–{fmtPrice(cell.p75 as number)}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[460px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-background/95 px-4 py-2 text-left text-xs font-medium text-muted-foreground backdrop-blur-sm">
                Type
              </th>
              {matrix.bedCols.map((b) => (
                <th key={b} className="px-3 py-2 text-right font-mono text-xs font-medium text-muted-foreground">
                  {bedLabel(b)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const inHome = row.label === IN_HOME_UNIT_LABEL;
              return (
                <tr key={row.label} className="border-t border-border transition-colors hover:bg-muted/30">
                  <td
                    className={`sticky left-0 z-10 bg-background/95 px-4 py-2.5 text-sm backdrop-blur-sm ${
                      inHome ? "text-muted-foreground" : "text-foreground"
                    }`}
                  >
                    {row.label}
                  </td>
                  {row.cells.map((cell, i) => {
                    const hasRange = sell && cell.p25 != null && cell.p75 != null && cell.p25 < cell.p75;
                    const dense = cell.median !== null && cell.count >= DENSE_N;
                    return (
                      <td
                        key={i}
                        className={`whitespace-nowrap px-3 py-2.5 text-right align-top font-mono tabular-nums ${
                          dense && !inHome ? cellTint : ""
                        }`}
                      >
                        {cell.median !== null ? (
                          <span title={`${cell.count} ${unit}${cell.count === 1 ? "" : "s"}`}>
                            <span className={`font-semibold ${inHome ? "text-muted-foreground" : "text-foreground"}`}>
                              {fmt(cell.median)}
                            </span>
                            <span className="ml-1 text-[10px] font-normal text-muted-foreground">×{cell.count}</span>
                            {hasRange && (
                              <span className="block text-[10px] leading-tight text-muted-foreground">
                                {fmtPrice(cell.p25 as number)}–{fmtPrice(cell.p75 as number)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">–</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
        {sell
          ? actual
            ? "Median price homes actually sold for; the small band is the middle 50% of those sales (×n = closed sales). Sold data via TRREB VOW — for your personal, non-commercial use."
            : "Median asking price of live for-sale listings; the small band is the middle 50% (×n = listings) — not an appraisal."
          : actual
            ? "Median price homes actually leased for (×n = signed leases). Sold data via TRREB VOW — for your personal, non-commercial use."
            : "Median asking rent of live rental listings (×n = listings) — not a rent appraisal."}
      </p>
      {showSignInNudge && !actual && (
        <SignInLink className="block border-t border-border px-4 py-2 text-xs font-medium text-cyan-700 hover:bg-cyan-500/5 dark:text-cyan-300">
          {sell
            ? "See what homes here actually sold for — sign in free →"
            : "See what homes here actually leased for — sign in free →"}
        </SignInLink>
      )}
    </section>
  );
}
