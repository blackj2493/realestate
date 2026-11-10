"use client";

/**
 * Power-of-sale share of Ontario home sales: one bar per month (the single month) and a line
 * for the 3 months ending that month (the index headline, steadier).
 *
 * Colour: bars #ea580c (orange-600), line #0d9488 (teal-600) — validated together against the
 * light (#e9edf4) and dark (#020617) page surfaces with the dataviz validate_palette.js (both
 * PASS). Two series, so a legend; the line is also direct-labelled at its last point. Text
 * stays in text tokens. Hover/focus/tap a month for its values; every number is also in the
 * page's text, so nothing is chart-only.
 */
import { useEffect, useRef, useState } from "react";

export interface SharePoint {
  edition: string; // YYYY-MM
  label: string; // "October 2026"
  pos: number;
  sales: number;
  sharePct: number;
  avg3Pct: number | null;
}

const BAR = "#ea580c";
const LINE = "#0d9488";
const PAD = { top: 18, right: 56, bottom: 28, left: 44 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (e: string) => `${MONTHS[Number(e.slice(5, 7)) - 1]} ${e.slice(2, 4)}`;

function niceMax(v: number): number {
  const steps = [0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];
  return steps.find((s) => s >= v) ?? Math.ceil(v);
}

export default function PosShareChart({ points }: { points: SharePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real pixel width, so the 11px labels stay 11px on a phone (a fixed viewBox
  // scaled down to ~330px made them ~5px).
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (points.length < 4) return null;
  const H = W < 480 ? 200 : 240;
  const IW = W - PAD.left - PAD.right;
  const IH = H - PAD.top - PAD.bottom;
  const last = points.length - 1;
  const max = niceMax(Math.max(...points.map((p) => Math.max(p.sharePct, p.avg3Pct ?? 0))) * 1.05);
  const yTicks = [0, max / 2, max];
  const slot = IW / points.length;
  const x = (i: number) => PAD.left + slot * (i + 0.5);
  const y = (v: number) => PAD.top + IH - (v / max) * IH;
  const barW = Math.max(2, slot - (slot > 12 ? 3 : 2));
  const linePts = points.map((p, i) => (p.avg3Pct == null ? null : `${x(i)},${y(p.avg3Pct)}`)).filter(Boolean).join(" ");
  const xLabels = [0, Math.floor(last / 2), last];
  const cur = hover !== null ? points[hover] : points[last];
  const lastAvg = points[last].avg3Pct;

  return (
    <figure className="min-w-0">
      {/* Readout: the hovered month, else the latest. */}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        <span className="font-medium text-foreground">{cur.label}</span>: {cur.sharePct.toFixed(2)}% ({cur.pos} of {cur.sales.toLocaleString("en-CA")} sales)
        {cur.avg3Pct != null && <> · 3-month {cur.avg3Pct.toFixed(2)}%</>}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BAR }} aria-hidden="true" />
          Single month
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: LINE }} aria-hidden="true" />
          3 months to that month
        </span>
      </div>
      <div ref={wrap} className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-auto w-full touch-none select-none"
        role="img"
        aria-label={`Power-of-sale share of Ontario home sales by month, ${points[0].label} to ${points[last].label}: from ${points[0].sharePct.toFixed(2)}% to ${points[last].sharePct.toFixed(2)}%.`}
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">
              {t === 0 ? "0%" : `${t.toFixed(2).replace(/0$/, "")}%`}
            </text>
          </g>
        ))}
        {xLabels.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} className="fill-muted-foreground text-[11px]">
            {short(points[i].edition)}
          </text>
        ))}

        {points.map((p, i) => {
          const top = y(p.sharePct);
          const h = Math.max(0, y(0) - top);
          const r = Math.min(4, barW / 2, h);
          const bx = x(i) - barW / 2;
          const d = `M${bx},${y(0)} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${y(0)} Z`;
          return <path key={p.edition} d={d} fill={BAR} opacity={hover === null || hover === i ? 0.9 : 0.35} />;
        })}

        {/* 3-month line, with a surface halo so it reads over the bars */}
        <polyline points={linePts} fill="none" className="stroke-background" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={linePts} fill="none" stroke={LINE} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {lastAvg != null && (
          <>
            <circle cx={x(last)} cy={y(lastAvg)} r={4.5} fill={LINE} className="stroke-background" strokeWidth={2} />
            <text x={x(last) + 9} y={y(lastAvg)} dy="0.32em" className="fill-foreground text-[12px] font-semibold">
              {lastAvg.toFixed(2)}%
            </text>
          </>
        )}

        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + IH} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray="3 3" />
            {points[hover].avg3Pct != null && (
              <circle cx={x(hover)} cy={y(points[hover].avg3Pct as number)} r={5} fill={LINE} className="stroke-background" strokeWidth={2} />
            )}
          </g>
        )}

        {points.map((p, i) => (
          <rect
            key={p.edition}
            x={x(i) - slot / 2}
            y={PAD.top}
            width={slot}
            height={IH}
            fill="transparent"
            tabIndex={0}
            aria-label={`${p.label}: ${p.sharePct.toFixed(2)}%, ${p.pos} power-of-sale sales`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onTouchStart={() => setHover(i)}
          />
        ))}
      </svg>
      </div>
    </figure>
  );
}
