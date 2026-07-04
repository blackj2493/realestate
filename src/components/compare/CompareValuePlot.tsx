"use client";

/**
 * CompareValuePlot — the "Value plot" lens of Compare.
 *
 * One labelled dot per shortlisted home on a value × yield map:
 *   X = list price vs our PureProperty Estimate  (right = listed UNDER our estimate)
 *   Y = cap rate from your assumptions            (up = higher yield)
 * so the top-right corner is the sweet spot. It reuses the SAME computed numbers
 * the table shows — `underwriting.capRatePct` and the cached AVM `estimatedValue`
 * — so the two views can never disagree. No re-derivation, no AI (CLAUDE.md §4).
 *
 * The value axis is VOW-derived (the Estimate), so it's members-only: anonymous
 * users get a locked panel pointing at sign-in, mirroring the table's gated cells.
 */

import Link from "next/link";
import { Lock } from "lucide-react";
import type { MetricContext } from "@/lib/compare/compareMetricsConfig";
import { formatPrice } from "@/lib/utils";

const C = {
  best: "#34d399", // emerald-400 — under estimate + higher yield
  over: "#fb7185", // rose-400    — over estimate + lower yield
  mid: "#94a3b8", // slate-400   — in between
  grid: "#1e293b",
  divider: "#334155",
  axis: "#64748b",
  label: "#e2e8f0",
  sub: "#94a3b8",
};

interface PlotPoint {
  n: number;
  ctx: MetricContext;
  cap: number;
  discount: number; // % under (+) / over (−) our estimate
  price: number;
  addr: string;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function classify(p: PlotPoint, capMedian: number): "best" | "over" | "mid" {
  const under = p.discount > 3;
  const over = p.discount < -3;
  if (under && p.cap >= capMedian) return "best";
  if (over && p.cap < capMedian) return "over";
  return "mid";
}

export default function CompareValuePlot({
  contexts,
}: {
  contexts: MetricContext[];
}) {
  const isAuthed = contexts[0]?.isAuthed ?? false;

  const points: PlotPoint[] = contexts
    .map((ctx, i) => {
      const cap = ctx.underwriting?.capRatePct;
      const est = ctx.estimate?.estimatedValue;
      const price = ctx.listing.ListPrice;
      if (cap == null || est == null || !est || !price) return null;
      return {
        n: i + 1,
        ctx,
        cap,
        discount: ((est - price) / est) * 100,
        price,
        addr: ctx.listing.UnparsedAddress?.trim() || ctx.listing.City || "Address unavailable",
      } satisfies PlotPoint;
    })
    .filter((p): p is PlotPoint => p !== null);

  if (!isAuthed) {
    return (
      <Panel>
        <Lock className="mb-3 h-6 w-6 text-cyan-700 dark:text-cyan-400" />
        <p className="mb-1 text-sm font-medium text-foreground">The value plot is members-only</p>
        <p className="mb-4 max-w-sm text-xs leading-relaxed text-muted-foreground">
          It maps each home against our comp value — what recent comparable sales support — a
          VOW-derived figure we only show to signed-in members. The table works either way.
        </p>
        <Link
          href="/login"
          className="inline-flex min-h-[40px] items-center rounded-md border border-cyan-400/50 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/30"
        >
          Sign in — free
        </Link>
      </Panel>
    );
  }

  if (points.length < 2) {
    return (
      <Panel>
        <p className="mb-1 text-sm font-medium text-foreground">Not enough comp values to plot</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          The value plot needs our comp value for at least 2 of these homes — {points.length} of{" "}
          {contexts.length} are ready. Use the table view in the meantime.
        </p>
      </Panel>
    );
  }

  // ── geometry ───────────────────────────────────────────────────────────────
  const W = 720, H = 460;
  const PAD = { l: 56, r: 26, t: 40, b: 54 };
  const X0 = PAD.l, X1 = W - PAD.r, Y0 = H - PAD.b, Y1 = PAD.t;

  const discounts = points.map((p) => p.discount);
  const caps = points.map((p) => p.cap);
  const xHalf = Math.max(8, Math.ceil(Math.max(...discounts.map(Math.abs)) + 2));
  const xDom: [number, number] = [-xHalf, xHalf];
  const capLo = Math.min(...caps), capHi = Math.max(...caps);
  const yPad = Math.max(0.6, (capHi - capLo) * 0.18);
  const yDom: [number, number] = [capLo - yPad, capHi + yPad];

  const xS = (v: number) => X0 + ((v - xDom[0]) / (xDom[1] - xDom[0])) * (X1 - X0);
  const yS = (v: number) => Y0 - ((v - yDom[0]) / (yDom[1] - yDom[0])) * (Y0 - Y1);
  const capMedian = median(caps);
  const xMid = xS(0), yMid = yS(capMedian);

  const fmtDisc = (d: number) =>
    d >= 0 ? `${d.toFixed(0)}% under comps` : `${Math.abs(d).toFixed(0)}% over comps`;

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <p className="mb-3 text-center text-xs text-muted-foreground">
        Each dot is one shortlisted home. <b className="text-foreground">Up = higher yield, right = better value</b>{" "}
        (listed under comp value). The top-right corner is the sweet spot.
      </p>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* plot */}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-0 lg:flex-1" role="img" aria-label="Value vs yield plot">
          {/* quadrant tints */}
          <rect x={xMid} y={Y1} width={X1 - xMid} height={yMid - Y1} fill="#34d399" opacity={0.06} />
          <rect x={X0} y={yMid} width={xMid - X0} height={Y0 - yMid} fill="#fb7185" opacity={0.05} />
          {/* dividers */}
          <line x1={xMid} y1={Y1} x2={xMid} y2={Y0} stroke={C.divider} strokeDasharray="4 4" />
          <line x1={X0} y1={yMid} x2={X1} y2={yMid} stroke={C.divider} strokeDasharray="4 4" />
          {/* frame */}
          <rect x={X0} y={Y1} width={X1 - X0} height={Y0 - Y1} fill="none" stroke={C.grid} />

          {/* corner labels */}
          <QLabel x={X1 - 8} y={Y1 + 16} anchor="end" color={C.best} title="BEST VALUE" sub="cheaper + higher yield" />
          <QLabel x={X0 + 8} y={Y1 + 16} anchor="start" color={C.sub} title="PREMIUM" sub="pricey, still yields" />
          <QLabel x={X1 - 8} y={Y0 - 20} anchor="end" color={C.sub} title="CHEAP, LOW YIELD" sub="price is right, return isn’t" />
          <QLabel x={X0 + 8} y={Y0 - 20} anchor="start" color={C.over} title="OVERPRICED" sub="over comp value + low yield" />

          {/* axis captions */}
          <text x={(X0 + X1) / 2} y={H - 16} textAnchor="middle" fontSize={11} fontWeight={600} fill={C.axis}>
            ◄ over comp value &nbsp;&nbsp; PRICE vs COMPS &nbsp;&nbsp; under comp value ►
          </text>
          <text
            x={16}
            y={(Y0 + Y1) / 2}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill={C.axis}
            transform={`rotate(-90 16 ${(Y0 + Y1) / 2})`}
          >
            ▼ lower yield &nbsp;&nbsp; CAP RATE &nbsp;&nbsp; higher yield ▲
          </text>

          {/* dots */}
          {points.map((p) => {
            const cx = xS(p.discount), cy = yS(p.cap);
            const col = C[classify(p, capMedian)];
            return (
              <g key={p.n}>
                <circle cx={cx} cy={cy} r={14} fill={col} fillOpacity={0.22} stroke={col} strokeWidth={2} />
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={C.label}>
                  {p.n}
                </text>
              </g>
            );
          })}
        </svg>

        {/* key — numbered, doubles as a compact summary (no label overlap) */}
        <ol className="shrink-0 space-y-1.5 lg:w-[300px]">
          {points.map((p) => {
            const col = C[classify(p, capMedian)];
            return (
              <li key={p.n} className="flex items-start gap-2.5 rounded-md border border-border/70 bg-card/40 px-2.5 py-2">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-slate-950"
                  style={{ backgroundColor: col }}
                >
                  {p.n}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/properties/${p.ctx.listing.id}`} className="block truncate text-xs font-medium text-foreground hover:text-cyan-300">
                    {p.addr}
                  </Link>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    <span className="text-emerald-700 dark:text-emerald-400">{formatPrice(p.price)}</span> · {p.cap.toFixed(1)}% cap ·{" "}
                    <span style={{ color: col }}>{fmtDisc(p.discount)}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
        <Legend color={C.best} label="best-value corner" />
        <Legend color={C.over} label="overpriced corner" />
        <Legend color={C.mid} label="in between" />
      </div>
    </div>
  );
}

function QLabel({ x, y, anchor, color, title, sub }: { x: number; y: number; anchor: "start" | "end"; color: string; title: string; sub: string }) {
  return (
    <>
      <text x={x} y={y} textAnchor={anchor} fontSize={11.5} fontWeight={800} letterSpacing="0.04em" fill={color}>
        {title}
      </text>
      <text x={x} y={y + 14} textAnchor={anchor} fontSize={10} fill={C.sub}>
        {sub}
      </text>
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-border bg-card/40 p-8 text-center">
      {children}
    </div>
  );
}
