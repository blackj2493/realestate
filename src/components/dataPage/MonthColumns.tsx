"use client";

/**
 * Homes sold by calendar month: one column per month, the busiest three in full teal
 * (#0d9488, validated against both page surfaces with the dataviz validator), the others
 * lighter. One series, so no legend; the title names it. Hover, focus or tap a month for
 * its value. Every number is also in the page's table, so nothing is chart-only.
 */
import { useEffect, useRef, useState } from "react";

const TEAL = "#0d9488";
const PAD = { top: 22, right: 8, bottom: 26, left: 8 };

export default function MonthColumns({ months, ariaLabel }: { months: { label: string; sales: number }[]; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (months.length !== 12) return null;

  const H = W < 480 ? 180 : 220;
  const IW = W - PAD.left - PAD.right;
  const IH = H - PAD.top - PAD.bottom;
  const max = Math.max(...months.map((m) => m.sales));
  const top3 = new Set([...months.map((m, i) => ({ i, s: m.sales }))].sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.i));
  const slot = IW / 12;
  const barW = Math.max(6, slot - (slot > 30 ? 10 : 4));
  const x = (i: number) => PAD.left + slot * (i + 0.5);
  const y = (v: number) => PAD.top + IH - (v / max) * IH;
  const cur = hover ?? months.findIndex((m) => m.sales === max);

  return (
    <figure className="min-w-0">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        <span className="font-medium text-foreground">{months[cur].label}</span>: {months[cur].sales.toLocaleString("en-CA")} homes sold
        {top3.has(cur) && <> · one of the 3 busiest months</>}
      </p>
      <div ref={wrap} className="w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full touch-none select-none" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={1} />
          {months.map((m, i) => {
            const top = y(m.sales);
            const h = Math.max(0, y(0) - top);
            const r = Math.min(4, barW / 2, h);
            const bx = x(i) - barW / 2;
            const d = `M${bx},${y(0)} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${y(0)} Z`;
            const strong = top3.has(i);
            return (
              <g key={m.label}>
                <path d={d} fill={TEAL} opacity={hover !== null && hover !== i ? 0.3 : strong ? 0.95 : 0.45} />
                {/* Narrow chart: the labels of 3 side-by-side bars collide, so label only the peak (or the hovered month). */}
                {(hover === i || (hover === null && (slot >= 40 ? strong : m.sales === max))) && (
                  <text x={x(i)} y={top - 6} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
                    {m.sales.toLocaleString("en-CA")}
                  </text>
                )}
                <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {W < 480 ? m.label.slice(0, 1) : m.label.slice(0, 3)}
                </text>
              </g>
            );
          })}
          {months.map((m, i) => (
            <rect
              key={m.label}
              x={x(i) - slot / 2}
              y={PAD.top}
              width={slot}
              height={IH}
              fill="transparent"
              tabIndex={0}
              aria-label={`${m.label}: ${m.sales} homes sold`}
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
