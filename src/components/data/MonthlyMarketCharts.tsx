"use client";

/**
 * Two small charts for a city's housing-market page: the monthly median sale price (line)
 * and the number of sales (bars), ~24 months.
 *
 * TWO CHARTS, NOT ONE: price and sales have different scales, and a dual-axis chart lets
 * the reader compare two arbitrary scales as if they were one. One series each, so no
 * legend: the title names it. Colour: teal-600 (#0d9488), validated against the light
 * (#e9edf4) and dark (#020617) page surfaces (dataviz validate_palette.js, both PASS).
 * Text stays in text tokens. Hover/focus a month for its exact values; the same numbers
 * are in the page's month table and its sentences, so nothing is chart-only.
 */
import { useEffect, useRef, useState } from "react";

export interface MonthPoint {
  month: string; // YYYY-MM
  label: string; // "October 2026"
  medianPrice: number;
  sales: number;
}

const PAD = { top: 16, right: 16, bottom: 26, left: 56 };
const COLOUR = "#0d9488"; // teal-600, the data-page colour (validated on both surfaces)

const short = (ym: string) => {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(ym.slice(5, 7)) - 1];
  return `${m} ${ym.slice(2, 4)}`;
};
const usdK = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}K`);

/** Round "nice" ticks over [lo, hi]. */
function ticks(lo: number, hi: number, n = 3): number[] {
  const span = hi - lo || hi || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  // Always end at or above hi, so the highest mark never draws above the top grid line.
  for (let v = start; ; v += step) {
    out.push(v);
    if (v >= hi - step * 0.001 || out.length > 12) break;
  }
  return out;
}

function Chart({
  title,
  points,
  kind,
  hover,
  setHover,
  W,
}: {
  W: number;
  title: string;
  points: MonthPoint[];
  kind: "price" | "sales";
  hover: number | null;
  setHover: (i: number | null) => void;
}) {
  const H = W < 480 ? 170 : 190;
  const IW = W - PAD.left - PAD.right;
  const IH = H - PAD.top - PAD.bottom;
  const vals = points.map((p) => (kind === "price" ? p.medianPrice : p.sales));
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  // Price: a line may start above zero (its job is the change); bars always start at zero.
  const yTicks = kind === "price" ? ticks(min * 0.97, max * 1.02) : ticks(0, max);
  const y0 = yTicks[0];
  const y1 = yTicks[yTicks.length - 1];
  // Each month sits in the centre of its own slot (both charts), so bars never cross the
  // y labels and the two charts' hover positions line up.
  const slot = IW / points.length;
  const x = (i: number) => PAD.left + slot * (i + 0.5);
  const y = (v: number) => PAD.top + IH - ((v - y0) / (y1 - y0 || 1)) * IH;
  const fmt = kind === "price" ? usdK : (n: number) => Math.round(n).toLocaleString("en-CA");
  const barW = Math.max(2, slot - 2); // 2px surface gap between bars
  const xLabels = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const last = points.length - 1;

  return (
    <figure className="min-w-0">
      <figcaption className="text-sm font-medium text-foreground">{title}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 h-auto w-full touch-none select-none"
        role="img"
        aria-label={`${title}, ${points[0].label} to ${points[last].label}. From ${fmt(vals[0])} to ${fmt(vals[last])}.`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Recessive grid + y labels */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">
              {fmt(t)}
            </text>
          </g>
        ))}
        {xLabels.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} className="fill-muted-foreground text-[11px]">
            {short(points[i].month)}
          </text>
        ))}

        {kind === "sales" ? (
          points.map((p, i) => {
            const top = y(p.sales);
            const h = Math.max(0, y(0) - top);
            const r = Math.min(4, barW / 2, h);
            const bx = x(i) - barW / 2;
            // Rounded data end (top), square baseline.
            const d = `M${bx},${y(0)} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${y(0)} Z`;
            return <path key={p.month} d={d} fill={COLOUR} opacity={hover === null || hover === i ? 1 : 0.45} />;
          })
        ) : (
          <>
            <polyline
              points={points.map((p, i) => `${x(i)},${y(p.medianPrice)}`).join(" ")}
              fill="none"
              stroke={COLOUR}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {/* Direct label on the latest point only */}
            <circle cx={x(last)} cy={y(vals[last])} r={4} fill={COLOUR} className="stroke-background" strokeWidth={2} />
          </>
        )}

        {/* Hover crosshair + marker */}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + IH} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray="3 3" />
            {kind === "price" && <circle cx={x(hover)} cy={y(vals[hover])} r={5} fill={COLOUR} className="stroke-background" strokeWidth={2} />}
          </g>
        )}

        {/* Hit targets: one full-height column per month, wider than the mark */}
        {points.map((p, i) => (
          <rect
            key={p.month}
            x={x(i) - slot / 2}
            y={PAD.top}
            width={slot}
            height={IH}
            fill="transparent"
            tabIndex={0}
            aria-label={`${p.label}: ${fmt(vals[i])}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onTouchStart={() => setHover(i)}
          />
        ))}
      </svg>
    </figure>
  );
}

export default function MonthlyMarketCharts({ city, points }: { city: string; points: MonthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real pixel width, so the 11px labels stay 11px on a phone.
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (points.length < 6) return null;
  const p = hover !== null ? points[hover] : points[points.length - 1];
  return (
    <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="charts">
      <h2 id="charts" className="text-lg font-semibold">The last {points.length} months in {city}</h2>
      {/* Readout: the hovered month, else the latest. Text tokens, not the series colour. */}
      <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
        <span className="font-medium text-foreground">{p.label}</span>: median sale price ${p.medianPrice.toLocaleString("en-CA")},{" "}
        {p.sales.toLocaleString("en-CA")} sales
      </p>
      <div ref={wrap} className="mt-3 grid gap-6">
        <Chart W={W} title="Median sale price, all home types" points={points} kind="price" hover={hover} setHover={setHover} />
        <Chart W={W} title="Number of sales" points={points} kind="sales" hover={hover} setHover={setHover} />
      </div>
    </section>
  );
}
