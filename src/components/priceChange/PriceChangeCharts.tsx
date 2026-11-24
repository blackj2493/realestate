/**
 * Charts for /data/price-change: plain server-rendered bars, so every figure is also text in
 * the HTML. Bars grow left-to-right by the size of the change; the label carries the sign.
 * Teal = houses, slate = condos. A faded bar = no clear change (95% range includes zero).
 */
import Link from "next/link";
import type { Change } from "@/lib/data/priceChangeModel";
import { priceChangePath, type PriceChangeArea, type QuarterChange } from "@/lib/data/priceChange";

const TEAL = "#0d9488";
const SLATE = "rgb(100 116 139 / 0.75)";
const FADED = "rgb(148 163 184 / 0.35)";

const label = (c: Change) => `${c.pct >= 0 ? "+" : "−"}${Math.abs(c.pct).toFixed(1)}%${c.significant ? "" : " (n.c.)"}`;

function Bar({ c, max, color, strong = false }: { c: Change | null; max: number; color: string; strong?: boolean }) {
  if (!c) return <span className="text-xs text-muted-foreground">too few sales</span>;
  const w = (Math.abs(c.pct) / max) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 shrink-0 rounded-r-[3px]" style={{ width: `${Math.max(0.8, w) * 0.8}%`, background: c.significant ? color : FADED }} aria-hidden="true" />
      <span className={`text-xs tabular-nums ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label(c)}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TEAL }} aria-hidden="true" />
        Houses (detached, semi, town)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SLATE }} aria-hidden="true" />
        Condos
      </span>
    </div>
  );
}

/** Each quarter against the same quarter a year earlier. */
export function QuarterBars({ quarters }: { quarters: QuarterChange[] }) {
  const vals = quarters.flatMap((q) => [q.house, q.condo, q.all]).filter((c): c is Change => Boolean(c));
  const max = Math.max(...vals.map((c) => Math.abs(c.pct)), 1) * 1.1;
  return (
    <div>
      <Legend />
      <ul className="mt-4 space-y-3">
        {quarters.map((q) => (
          <li key={q.label} className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
            <span className="text-sm">{q.label}</span>
            <div className="space-y-1">
              {q.house || q.condo ? (
                <>
                  <Bar c={q.house} max={max} color={TEAL} />
                  <Bar c={q.condo} max={max} color={SLATE} />
                </>
              ) : (
                <Bar c={q.all} max={max} color={TEAL} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** All-home change by city, largest drop first. */
export function CityChangeBars({ areas, current }: { areas: PriceChangeArea[]; current?: string }) {
  const max = Math.max(...areas.map((a) => Math.abs(a.all!.pct)), 1) * 1.1;
  return (
    <ul className="space-y-2">
      {areas.map((a) => {
        const me = a.slug === current;
        return (
          <li key={a.slug} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
            {me ? (
              <span className="truncate text-sm font-semibold">{a.city}</span>
            ) : (
              <Link href={priceChangePath(a.slug)} className="truncate text-sm underline-offset-4 hover:underline">
                {a.city}
              </Link>
            )}
            <Bar c={a.all} max={max} color={me ? TEAL : SLATE} strong={me} />
          </li>
        );
      })}
    </ul>
  );
}
