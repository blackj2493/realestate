/**
 * Typical rents nearby — median asking rent by bedrooms × property type, computed
 * from live FOR RENT listings around the subject (getNearbyForSale lease mode).
 *
 * IDX asking rents are fully public (same anon-safe class as every other asking
 * surface on the address pages) — no gate. Renders null when the matrix is null
 * (thin sample) so callers can mount it unconditionally.
 */
import type { AskingMatrix } from "@/lib/address/nearbyForSale";

const fmtRent = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

const bedLabel = (b: number) => (b >= 4 ? "4+ bd" : `${b} bd`);

export default function TypicalRentsCard({
  matrix,
  radiusKm,
}: {
  matrix: AskingMatrix | null;
  radiusKm: number;
}) {
  if (!matrix) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card/40">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">Typical rents nearby</h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          {matrix.sample} live rentals · {radiusKm} km
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
                  <td key={i} className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {cell.median !== null ? (
                      <span
                        className="font-semibold text-foreground"
                        title={`${cell.count} live rental${cell.count === 1 ? "" : "s"}`}
                      >
                        {fmtRent(cell.median)}
                        <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">/mo</span>
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
        Median asking rent of live rental listings nearby — not a rent appraisal.
      </p>
    </section>
  );
}
