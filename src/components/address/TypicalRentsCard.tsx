/**
 * Typical rents nearby — median rent by bedrooms × property type.
 *
 * Two sources (see lib/address/leasedRents.ts):
 *  - "leased" (consumers): medians of ACTUAL close prices from the VOW lease archive.
 *    Mount only with consumer-fetched data — the structural gate lives in the fetcher.
 *  - "asking" (everyone): medians of live FOR RENT list prices (IDX-public).
 *
 * Every cell with data renders — the muted ×count beside each figure is the honesty
 * device for thin samples (owner decision 2026-07-24: one real data point beats a
 * dash). Medians throughout (rent tails skew the mean). Renders null on null matrix.
 */
import Link from "next/link";
import type { AskingMatrix } from "@/lib/address/nearbyForSale";

const fmtRent = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

const bedLabel = (b: number) => (b === 0 ? "Studio" : b >= 6 ? "6+ bd" : `${b} bd`);

export default function TypicalRentsCard({
  matrix,
  radiusKm,
  source = "asking",
  showSignInNudge = false,
}: {
  matrix: AskingMatrix | null;
  radiusKm: number;
  /** "leased" = actual close prices (consumer/VOW); "asking" = live list prices. */
  source?: "leased" | "asking";
  /** Anonymous viewers: advertise the leased upgrade under the asking grid. */
  showSignInNudge?: boolean;
}) {
  if (!matrix) return null;
  const leased = source === "leased";
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card/40">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">
          {leased ? "What homes rent for here" : "Typical rents nearby"}
        </h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          {matrix.sample} {leased ? "leases · ~6 mo" : "live rentals"} · {radiusKm} km
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
                {row.cells.map((cell, i) => (
                  <td key={i} className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                    {cell.median !== null ? (
                      <span title={`${cell.count} ${leased ? "signed lease" : "live rental"}${cell.count === 1 ? "" : "s"}`}>
                        <span className="font-semibold text-foreground">{fmtRent(cell.median)}</span>
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">×{cell.count}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
        {leased
          ? "Median price homes actually leased for (×n = signed leases). Sold data via TRREB VOW — for your personal, non-commercial use."
          : "Median asking rent of live rental listings (×n = listings) — not a rent appraisal."}
      </p>
      {showSignInNudge && !leased && (
        <Link
          href="/login"
          className="block border-t border-border px-4 py-2 text-xs font-medium text-cyan-700 hover:bg-cyan-500/5 dark:text-cyan-300"
        >
          See what homes here actually leased for — sign in free →
        </Link>
      )}
    </section>
  );
}
