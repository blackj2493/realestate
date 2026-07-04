'use client';

import React from 'react';

/**
 * Shadow MLS - Price Compression Card
 * 
 * Property panel component displaying price drop metrics:
 * - true_price_drop_pct (oversized font)
 * - Alarm state if > 15% with pulsing animation
 * - Capital discount (peak - current)
 */

interface PriceCompressionCardProps {
  truePriceDropPct?: number;
  peakPrice?: number;
  currentPrice?: number;
  className?: string;
}

const PRICE_DROP_ALARM_THRESHOLD = 15;

export function PriceCompressionCard({ 
  truePriceDropPct = 0, 
  peakPrice = 0,
  currentPrice = 0,
  className = '' 
}: PriceCompressionCardProps) {
  const capitalDiscount = peakPrice - currentPrice;
  const isAlarm = truePriceDropPct > PRICE_DROP_ALARM_THRESHOLD;

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className={`
      bg-background border border-border rounded-lg p-4
      ${className}
    `}>
      {/* Header */}
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">
        Price Compression
      </div>

      {/* Primary: Price Drop Percentage */}
      <div className="mb-4">
        <div className="text-xs font-mono text-muted-foreground mb-1">Price Drop</div>
        <div className={`
          text-3xl font-mono uppercase tracking-tight
          ${isAlarm ? 'text-rose-500' : 'text-amber-600 dark:text-amber-400'}
        `}>
          {truePriceDropPct.toFixed(1)}%
        </div>
        <div className="text-xs font-mono text-muted-foreground mt-1">
          from peak listing price
        </div>
      </div>

      {/* Alarm Badge */}
      {isAlarm && (
        <div className={`
          animate-pulse bg-rose-500/10 border border-rose-500/30 
          text-rose-600 dark:text-rose-400 font-mono text-xs px-2 py-1 rounded mb-4
        `}>
          ⚠️ ALARM: INSTALMENT LIQUIDITY DRIFT &gt; 15%
        </div>
      )}

      {/* Secondary: Capital Discount */}
      <div className="border-t border-border pt-3 mt-3">
        <div className="text-xs font-mono text-muted-foreground mb-1">Capital Discount</div>
        <div className="text-xl font-mono text-emerald-600 dark:text-emerald-400">
          -{formatCurrency(capitalDiscount)}
        </div>
        <div className="text-xs font-mono text-muted-foreground mt-1">
          {formatCurrency(peakPrice)} peak → {formatCurrency(currentPrice)} now
        </div>
      </div>
    </div>
  );
}

export default PriceCompressionCard;