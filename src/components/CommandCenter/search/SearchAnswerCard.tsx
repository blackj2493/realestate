/**
 * SearchAnswerCard — "what's happening here" verdict shown above the suggestions
 * when the query targets a street/area. A map that answers, not just navigates.
 *
 * Dollar figures (median sold, $/sqft) are VOW-gated: masked for anonymous users
 * with a one-tap free sign-in. Logged-in users see the REAL trailing-12-month sold
 * stats + sparkline, fetched from /api/market/price-trend — the same gated endpoint
 * that powers /analytics, so this surfaces nothing the dashboard doesn't already.
 * Non-price context (active count) shows to everyone. We never fabricate figures:
 * if a figure isn't computable for the area, it renders "—", not a placeholder.
 */

"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, TrendingUp } from "lucide-react";
import { useIsAuthed } from "@/hooks/useIsAuthed";

interface Props {
  area: string;
  /** Live active-listing count in/near the area (real, from the suggest facets). */
  activeCount?: number;
}

interface TrendData {
  loading: boolean;
  /** Server says this caller isn't a VOW consumer → mask + sign-in CTA. */
  locked: boolean;
  medianSold: number | null;
  ppsf: number | null;
  /** Trailing-12-month sales count. */
  sales: number | null;
  /** Monthly median-sold series for the sparkline (chronological). */
  series: number[];
}

const EMPTY: TrendData = { loading: false, locked: false, medianSold: null, ppsf: null, sales: null, series: [] };

/** Compact money: $1.24M / $980K / $612. "—" for missing. */
function money(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

// Area-level sold trend isn't computed for raw street addresses (which start with a
// house number) — the endpoint keys on a city/community name.
const isRegionName = (area: string): boolean => !/^\s*\d/.test(area.trim());

/** Build a sparkline <path> (line + fill) from the monthly series, normalised to 132×40. */
function sparkPaths(series: number[]): { line: string; fill: string } | null {
  const pts = series.filter((n) => Number.isFinite(n));
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const W = 132;
  const H = 40;
  const pad = 5;
  const step = W / (pts.length - 1);
  const coords = pts.map((v, i) => {
    const x = Math.round(i * step);
    const y = Math.round(pad + (H - 2 * pad) * (1 - (v - min) / span));
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  return { line, fill: `${line} L132,40 L0,40 Z` };
}

function Spark({ series }: { series: number[] }) {
  const real = sparkPaths(series);
  // Real series when we have one; otherwise a flat muted baseline (no fake uptrend).
  const line = real?.line ?? "M0,30 L132,30";
  const fill = real?.fill ?? "M0,30 L132,30 L132,40 L0,40 Z";
  const stroke = real ? "#22d3ee" : "#334155";
  return (
    <svg width="132" height="40" viewBox="0 0 132 40" className="shrink-0">
      <defs>
        <linearGradient id="spk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.3" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#spk)" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

function Stat({ value, label, gated }: { value: string; label: string; gated?: boolean }) {
  return (
    <div>
      <div
        className={`font-mono text-base font-bold ${
          gated ? "blur-[5px] select-none text-rose-700 dark:text-rose-300" : "text-foreground"
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

export default function SearchAnswerCard({ area, activeCount }: Props) {
  const authed = useIsAuthed();
  const pathname = usePathname();
  const [data, setData] = React.useState<TrendData>(EMPTY);

  // Fetch the real, server-gated sold trend for logged-in users. Anonymous users
  // are masked client-side AND the endpoint would withhold data anyway, so we skip
  // the request entirely for them.
  React.useEffect(() => {
    if (!authed || !isRegionName(area)) {
      setData(EMPTY);
      return;
    }
    const ctrl = new AbortController();
    setData({ ...EMPTY, loading: true });
    fetch(`/api/market/price-trend?region=${encodeURIComponent(area.trim())}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (ctrl.signal.aborted) return;
        if (!j || j.locked) {
          setData({ ...EMPTY, locked: !!j?.locked });
          return;
        }
        const points: Array<{ medianPrice: number; medianPpsf: number | null; sales: number }> = Array.isArray(j.points)
          ? j.points
          : [];
        const last = points[points.length - 1];
        const last12 = points.slice(-12);
        setData({
          loading: false,
          locked: false,
          medianSold: last?.medianPrice ?? null,
          ppsf: last?.medianPpsf ?? null,
          sales: last12.reduce((s, p) => s + (p.sales || 0), 0) || null,
          series: points.map((p) => p.medianPrice).filter((n) => Number.isFinite(n)),
        });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setData(EMPTY);
      });
    return () => ctrl.abort();
  }, [area, authed]);

  const masked = !authed || data.locked;
  const dash = data.loading ? "…" : "—";
  const safeNext = pathname && pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : null;
  const loginHref = safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login";

  return (
    <div className="border-b border-border bg-gradient-to-b from-cyan-950/30 to-slate-950 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
          <TrendingUp className="h-3 w-3" />
          {area} · activity
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">last 12 mo</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-5">
          <Stat value={data.sales != null ? data.sales.toLocaleString() : dash} label="Sales" />
          <Stat value={masked ? "$6XX,XXX" : money(data.medianSold)} label="Median sold" gated={masked} />
          <Stat value={masked ? "$4XX" : money(data.ppsf)} label="$ / sqft" gated={masked} />
          <Stat value={activeCount != null ? activeCount.toLocaleString() : "—"} label="Active now" />
        </div>
        <Spark series={masked ? [] : data.series} />
      </div>
      {masked && (
        <Link
          href={loginHref}
          className="mt-2.5 inline-flex items-center gap-1.5 bg-cyan-500 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-950 transition-colors hover:bg-cyan-400"
        >
          <Lock className="h-3 w-3" />
          Unlock sold prices — free
        </Link>
      )}
    </div>
  );
}
