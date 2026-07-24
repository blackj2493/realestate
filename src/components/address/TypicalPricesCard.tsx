/**
 * What homes sell for here — median sale price by bedrooms × property type, each
 * well-sampled cell carrying its middle-50% range (owner call 2026-07-24: in
 * heterogeneous stock the range IS the information — "2bds here trade $530k–$750k"
 * beats a falsely precise point estimate; in uniform suburbs the tight band reads
 * as confirmation).
 *
 * Two sources (see lib/address/soldPrices.ts):
 *  - "sold" (consumers): medians/ranges of ACTUAL close prices from the VOW archive.
 *    Mount only with consumer-fetched data — the structural gate lives in the fetcher.
 *  - "asking" (everyone): medians/ranges of live FOR SALE list prices (IDX-public).
 *
 * Same honesty devices as the rents grid: every cell with data renders, ×count
 * beside each median, medians throughout. Renders null on null matrix.
 */
import Link from "next/link";
import type { AskingMatrix } from "@/lib/address/nearbyForSale";

/** Compact money: $620k, $1.24M — the grid is dense, full figures don't fit. */
const fmtPrice = (n: number) => {
  if (n >= 999_500) {
    const m = n / 1_000_000;
    return `$${(m >= 10 ? m.toFixed(1) : m.toFixed(2)).replace(/\.?0+$/, "")}M`;
  }
  return `$${Math.round(n / 1000)}k`;
};

const bedLabel = (b: number) => (b === 0 ? "Studio" : b >= 6 ? "6+ bd" : `${b} bd`);

export default function TypicalPricesCard({
  matrix,
  radiusKm,
  source = "asking",
  showSignInNudge = false,
}: {
  matrix: AskingMatrix | null;
  radiusKm: number;
  /** "sold" = actual close prices (consumer/VOW); "asking" = live list prices. */
  source?: "sold" | "asking";
  /** Anonymous viewers: advertise the sold upgrade under the asking grid. */
  showSignInNudge?: boolean;
}) {
  if (!matrix) return null;
  const sold = source === "sold";
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card/40">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">
          {sold ? "What homes sell for here" : "Typical asking prices nearby"}
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          {matrix.sample} {sold ? "sales · ~6 mo" : "live listings"} · {radiusKm} km
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Type</th>
              {matrix.bedCols.map((b) => (
                <th key={b} className="px-3 py-2 text-right font-mono text-xs font-medium text-muted-foreground">
                  {bedLabel(b)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.label} className="border-t border-border">
                <td className="px-4 py-2.5 text-sm text-foreground">{row.label}</td>
                {row.cells.map((cell, i) => {
                  const hasRange = cell.p25 != null && cell.p75 != null && cell.p25 < cell.p75;
                  return (
                    <td key={i} className="whitespace-nowrap px-3 py-2.5 text-right align-top font-mono tabular-nums">
                      {cell.median !== null ? (
                        <span title={`${cell.count} ${sold ? "closed sale" : "live listing"}${cell.count === 1 ? "" : "s"}`}>
                          <span className="font-semibold text-foreground">{fmtPrice(cell.median)}</span>
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground">×{cell.count}</span>
                          {hasRange && (
                            <span className="block text-[10px] leading-tight text-muted-foreground">
                              {fmtPrice(cell.p25 as number)}–{fmtPrice(cell.p75 as number)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
        {sold
          ? "Median price homes actually sold for; the small band is the middle 50% of those sales (×n = closed sales). Sold data via TRREB VOW — for your personal, non-commercial use."
          : "Median asking price of live for-sale listings; the small band is the middle 50% (×n = listings) — not an appraisal."}
      </p>
      {showSignInNudge && !sold && (
        <Link
          href="/login"
          className="block border-t border-border px-4 py-2 text-xs font-medium text-cyan-700 hover:bg-cyan-500/5 dark:text-cyan-300"
        >
          See what homes here actually sold for — sign in free →
        </Link>
      )}
    </section>
  );
}
