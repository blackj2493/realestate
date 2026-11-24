/**
 * Charts for /data/basement-value: plain server-rendered bars, so every figure is also text
 * in the HTML that crawlers and AI answer engines read. Teal = measured gain at sale,
 * orange = typical build cost (context, not measured).
 */
import Link from "next/link";
import type { BasementCity } from "@/lib/data/basementValue";
import { basementValuePath } from "@/lib/data/basementValue";

const TEAL = "#0d9488";
const ORANGE = "#ea580c";
const usd = (n: number) => `$${Math.round(n / 1000).toLocaleString("en-CA")}K`;

export interface ValueRow {
  label: string;
  /** Measured dollar gain at sale; null = not significant. */
  added: number | null;
  addedPct: string;
  cost: number;
}

/** Gain at sale against typical cost, two bars per project on one scale. */
export function ValueVsCost({ rows }: { rows: ValueRow[] }) {
  const max = Math.max(...rows.flatMap((r) => [r.added ?? 0, r.cost]), 1) * 1.1;
  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TEAL }} aria-hidden="true" />
          Added to the sale price
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: ORANGE, opacity: 0.85 }} aria-hidden="true" />
          Typical cost to build
        </span>
      </div>
      <ul className="mt-4 space-y-5">
        {rows.map((r) => (
          <li key={r.label}>
            <p className="text-sm font-medium">{r.label}</p>
            <div className="mt-1.5 space-y-1.5">
              <Bar width={((r.added ?? 0) / max) * 100} color={TEAL} text={r.added == null ? `${r.addedPct}` : `${usd(r.added)} added (${r.addedPct})`} />
              <Bar width={(r.cost / max) * 100} color={ORANGE} text={`${usd(r.cost)} typical cost`} faded />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bar({ width, color, text, faded = false }: { width: number; color: string; text: string; faded?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-4 shrink-0 rounded-r-[4px]"
        style={{ width: `${Math.max(0.8, width) * 0.7}%`, background: color, opacity: faded ? 0.85 : 1 }}
        aria-hidden="true"
      />
      <span className="text-xs tabular-nums text-foreground">{text}</span>
    </div>
  );
}

/** Finished-basement gap by city, largest first. Grey bar = not significant. */
export function CityGapBars({ cities, current }: { cities: BasementCity[]; current?: string }) {
  const max = Math.max(...cities.map((c) => Math.max(c.modelA!.effects.fin.pct, c.modelA!.effects.apt.pct)), 1) * 1.1;
  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TEAL }} aria-hidden="true" />
          Finished basement
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-slate-500/70" aria-hidden="true" />
          Basement apartment
        </span>
      </div>
      <ul className="mt-4 space-y-2.5">
        {cities.map((c) => {
          const me = c.slug === current;
          const fin = c.modelA!.effects.fin;
          const apt = c.modelA!.effects.apt;
          return (
            <li key={c.slug} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
              {me ? (
                <span className="truncate text-sm font-semibold">{c.city}</span>
              ) : (
                <Link href={basementValuePath(c.slug)} className="truncate text-sm underline-offset-4 hover:underline">
                  {c.city}
                </Link>
              )}
              <div className="space-y-1">
                <GapBar pct={fin.pct} max={max} significant={fin.significant} color={TEAL} strong={me} />
                <GapBar pct={apt.pct} max={max} significant={apt.significant} color="rgb(100 116 139 / 0.7)" strong={me} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GapBar({ pct, max, significant, color, strong }: { pct: number; max: number; significant: boolean; color: string; strong: boolean }) {
  const w = (Math.max(0, pct) / max) * 100;
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-2.5 shrink-0 rounded-r-[3px]"
        style={{ width: `${Math.max(0.8, w) * 0.8}%`, background: significant ? color : "rgb(148 163 184 / 0.35)" }}
        aria-hidden="true"
      />
      <span className={`text-xs tabular-nums ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {pct >= 0 ? "+" : "−"}
        {Math.abs(pct).toFixed(1)}%{significant ? "" : " (n.s.)"}
      </span>
    </div>
  );
}
