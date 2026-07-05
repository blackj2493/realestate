/**
 * DOMTimelineChart — honest price-vs-time view for a single listing.
 *
 * Two modes, both built only from real data (never fabricated):
 *
 *  1. PRICE HISTORY (when `saleMarkers` are supplied — authed users with prior sales):
 *     a long-horizon line through each recorded SOLD price (amber) ending at the
 *     current list price (emerald). This is the HouseSigma-beating "what did this
 *     actually sell for over the years vs. what they're asking now" view.
 *
 *  2. LIST-PRICE MOVEMENT (no sold markers): the FIRST list price (current + the
 *     deterministic TotalPriceDrop, or an explicit OriginalListPrice) and the
 *     CURRENT list price, dated by True DOM. When there's no recorded drop we say
 *     so plainly rather than inventing a synthetic original.
 *
 * Sold prices are VOW-gated upstream — `saleMarkers` is only ever populated for
 * authenticated users, so this component never has to gate anything itself.
 */

"use client";

import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingDown, Calendar, History } from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import { useChartTheme } from '@/lib/theme/useChartTheme';

/** A recorded prior sale (already VOW-gated upstream): close price at a sale date. */
export interface SaleMarker {
  /** ISO date of the sale (contract/close). */
  date: string;
  /** Sold/close price. */
  price: number;
}

interface DOMTimelineChartProps {
  /** Current list price. */
  currentPrice: number;
  /** Real cumulative $ drop from the first list price to current (Typesense TotalPriceDrop). */
  priceDrop?: number;
  /** Explicit original list price when known; used only if it's above the current price. */
  originalPrice?: number;
  /** Days on market (prefer True DOM). */
  dom: number;
  /** Prior SOLD prices for this property (authed only). When present, drives the price-history mode. */
  saleMarkers?: SaleMarker[];
  className?: string;
}

type PointKind = 'sold' | 'current';
interface ChartPoint {
  date: string;
  price: number;
  kind: PointKind;
}

// Declared at module scope so it isn't recreated on every render.
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; payload?: ChartPoint }>; label?: string }) {
  if (active && payload && payload.length) {
    const kind = payload[0].payload?.kind;
    return (
      <div className="bg-card border border-border rounded p-2 shadow-lg">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn('text-sm font-bold font-mono', kind === 'sold' ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')}>
          {formatPrice(payload[0].value)}
        </p>
        {kind && <p className="text-[10px] text-muted-foreground">{kind === 'sold' ? 'Sold' : 'Current asking'}</p>}
      </div>
    );
  }
  return null;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtMonthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Colored-dot renderer: amber for prior sales, emerald for the current asking.
function renderDot(props: { cx?: number; cy?: number; payload?: ChartPoint }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return <g />;
  const sold = payload?.kind === 'sold';
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={sold ? '#f59e0b' : '#10b981'}
      stroke={sold ? '#78350f' : '#065f46'}
      strokeWidth={1}
    />
  );
}

export default function DOMTimelineChart({
  currentPrice,
  priceDrop,
  originalPrice,
  dom,
  saleMarkers,
  className,
}: DOMTimelineChartProps) {
  const c = useChartTheme();

  // ── Mode 1: Price history (prior sales → current asking) ────────────────────
  const sales = (saleMarkers ?? [])
    .filter((s) => s && s.price > 0 && s.date && !Number.isNaN(new Date(s.date).getTime()))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (sales.length > 0 && currentPrice > 0) {
    const points: ChartPoint[] = [
      ...sales.map((s) => ({ date: fmtMonthYear(s.date), price: s.price, kind: 'sold' as const })),
      { date: 'Now', price: currentPrice, kind: 'current' as const },
    ];
    const lastSold = sales[sales.length - 1].price;
    const apprDelta = currentPrice - lastSold;
    const apprPct = lastSold > 0 ? Math.round((apprDelta / lastSold) * 100) : 0;

    return (
      <div className={cn('bg-card rounded-lg border border-border p-4', className)}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-amber-700 dark:text-amber-400" />
            <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Price History</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {sales.length} prior sale{sales.length > 1 ? 's' : ''}
          </span>
        </div>

        <div className="h-32 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: c.axisText, fontSize: 10 }}
                tickLine={{ stroke: c.axisLine }}
                axisLine={{ stroke: c.axisLine }}
              />
              <YAxis
                tick={{ fill: c.axisText, fontSize: 10 }}
                tickLine={{ stroke: c.axisLine }}
                axisLine={{ stroke: c.axisLine }}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                domain={['dataMin - 50000', 'dataMax + 50000']}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line type="linear" dataKey="price" stroke="#64748b" strokeWidth={2} dot={renderDot} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border">
          <div className="text-center">
            <span className="text-[10px] text-muted-foreground uppercase">Last Sold</span>
            <p className="text-xs font-mono text-amber-700 dark:text-amber-400">{formatPrice(lastSold)}</p>
          </div>
          <div className="text-center">
            <span className="text-[10px] text-muted-foreground uppercase">Now Asking</span>
            <p className="text-xs font-mono text-emerald-700 dark:text-emerald-400">{formatPrice(currentPrice)}</p>
          </div>
          <div className="text-center">
            <span className="text-[10px] text-muted-foreground uppercase">vs Last Sold</span>
            <p className={cn('text-xs font-mono', apprDelta >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>
              {apprDelta >= 0 ? '+' : ''}
              {apprPct}%
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Mode 2: List-price movement (no sold markers) ───────────────────────────
  // Real original price: an explicit OriginalListPrice if it's above current,
  // otherwise current + the deterministic cumulative drop. No drop ⇒ no original.
  const original =
    originalPrice && originalPrice > currentPrice
      ? originalPrice
      : priceDrop && priceDrop > 0
        ? currentPrice + priceDrop
        : null;

  const drop = original ? Math.max(0, original - currentPrice) : 0;
  const hasDrop = drop > 0 && currentPrice > 0;
  const dropPercent = hasDrop ? Math.round((drop / original!) * 100) : 0;

  // Endpoints only: first list price at listing start, current price today.
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - Math.max(0, dom));

  const Header = (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-amber-700 dark:text-amber-400" />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Price Timeline
        </span>
      </div>
      <div className="flex items-center gap-2">
        {hasDrop && (
          <div className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <TrendingDown className="h-3 w-3" />
            <span>-{dropPercent}%</span>
          </div>
        )}
        <span className="text-xs text-muted-foreground">{dom} days on market</span>
      </div>
    </div>
  );

  // Honest empty state — common for fresh active listings with no recorded reduction.
  if (!hasDrop) {
    return (
      <div className={cn("bg-card rounded-lg border border-border p-4", className)}>
        {Header}
        <div className="flex h-32 flex-col items-center justify-center text-center">
          <p className="font-mono text-lg text-foreground">{formatPrice(currentPrice)}</p>
          <p className="mt-1 text-xs text-muted-foreground">No recorded price changes</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Listed {fmtDate(start)} · still at original asking
          </p>
        </div>
      </div>
    );
  }

  const chartData = [
    { date: fmtDate(start), price: original! },
    { date: fmtDate(today), price: currentPrice },
  ];

  return (
    <div className={cn("bg-card rounded-lg border border-border p-4", className)}>
      {Header}

      <div className="h-32 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: c.axisText, fontSize: 10 }}
              tickLine={{ stroke: c.axisLine }}
              axisLine={{ stroke: c.axisLine }}
            />
            <YAxis
              tick={{ fill: c.axisText, fontSize: 10 }}
              tickLine={{ stroke: c.axisLine }}
              axisLine={{ stroke: c.axisLine }}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
              domain={['dataMin - 50000', 'dataMax + 50000']}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={currentPrice} stroke="#10b981" strokeDasharray="5 5" strokeWidth={1} />
            <Line
              type="linear"
              dataKey="price"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ fill: '#10b981', r: 3 }}
              activeDot={{ fill: '#34d399', r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border">
        <div className="text-center">
          <span className="text-[10px] text-muted-foreground uppercase">Original</span>
          <p className="text-xs font-mono text-foreground">{formatPrice(original!)}</p>
        </div>
        <div className="text-center">
          <span className="text-[10px] text-muted-foreground uppercase">Current</span>
          <p className="text-xs font-mono text-emerald-700 dark:text-emerald-400">{formatPrice(currentPrice)}</p>
        </div>
        <div className="text-center">
          <span className="text-[10px] text-muted-foreground uppercase">Drop</span>
          <p className="text-xs font-mono text-emerald-700 dark:text-emerald-400">-{dropPercent}%</p>
        </div>
      </div>
    </div>
  );
}
