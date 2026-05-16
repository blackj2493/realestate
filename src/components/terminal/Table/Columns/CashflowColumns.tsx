import React from 'react';

interface MetricCellProps {
  value: number;
  suffix?: string;
  highlightPositive?: boolean;
  highlightThreshold?: number;
  invertHighlight?: boolean; // true = red if above threshold
}

export function MetricCell({ value, suffix = '', highlightPositive = false, highlightThreshold = 0, invertHighlight = false }: MetricCellProps) {
  const isHighlighted = invertHighlight
    ? value > highlightThreshold
    : value < highlightThreshold && value > 0;

  return (
    <span className={`font-mono text-sm ${isHighlighted ? 'text-emerald-400' : 'text-slate-50'}`}>
      {value.toLocaleString('en-CA', { maximumFractionDigits: 2 })}
      {suffix}
    </span>
  );
}

interface CapRateCellProps {
  capRateEst?: number;
  capRateFloor?: number;
}

export function CapRateCell({ capRateEst, capRateFloor }: CapRateCellProps) {
  return (
    <div className="flex flex-col">
      <MetricCell
        value={capRateEst || 0}
        suffix="%"
        highlightThreshold={6}
        invertHighlight={false}
      />
      <span className="text-xs text-slate-500 font-mono mt-0.5">
        FLOOR {capRateFloor?.toFixed(2) || '—'}%
      </span>
    </div>
  );
}

interface CashflowCellProps {
  netMonthlyCashflow?: number;
  cashflowFloor?: number;
}

export function CashflowCell({ netMonthlyCashflow, cashflowFloor }: CashflowCellProps) {
  const isPositive = (netMonthlyCashflow || 0) > 0;
  return (
    <div className="flex flex-col">
      <span className={`font-mono text-sm ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
        {isPositive ? '+' : ''}${(netMonthlyCashflow || 0).toLocaleString('en-CA')}
        <span className="text-xs text-slate-500">/mo</span>
      </span>
      <span className="text-xs text-slate-500 font-mono mt-0.5">
        FLOOR ${(cashflowFloor || 0).toLocaleString('en-CA')}
      </span>
    </div>
  );
}

interface YieldCellProps {
  grossYieldEst?: number;
  suiteConfidence?: string | null;
}

export function YieldCell({ grossYieldEst, suiteConfidence }: YieldCellProps) {
  const isTargetYield = suiteConfidence === 'TARGET_YIELD';
  return (
    <div className="flex flex-col">
      <MetricCell
        value={grossYieldEst || 0}
        suffix="%"
        highlightThreshold={5}
      />
      {isTargetYield && (
        <span className="text-xs text-emerald-400 font-mono mt-0.5">TARGET</span>
      )}
    </div>
  );
}

interface OccupancyBadgeProps {
  occupancyStatus?: string;
}

export function OccupancyBadge({ occupancyStatus }: OccupancyBadgeProps) {
  if (occupancyStatus === 'Tenanted') {
    return (
      <span className="px-2 py-0.5 text-xs font-mono text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded">
        TENANTED
      </span>
    );
  }
  if (occupancyStatus === 'Vacant') {
    return (
      <span className="px-2 py-0.5 text-xs font-mono text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded">
        VACANT
      </span>
    );
  }
  return <span className="text-xs text-slate-500 font-mono">—</span>;
}