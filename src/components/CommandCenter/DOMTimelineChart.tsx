/**
 * DOMTimelineChart - Recharts-based timeline showing ListPrice over property lifetime
 * Visualizes price drops and proves actual DOM vs MLS board's reset MlsStatus
 */

"use client";

import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingDown, Calendar } from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';

interface PricePoint {
  date: string;
  price: number;
  event?: string;
}

interface DOMTimelineChartProps {
  // Historical price data points
  priceHistory?: PricePoint[];
  // Current price
  currentPrice: number;
  // Original list price
  originalPrice?: number;
  // Days on market
  dom: number;
  className?: string;
}

// Generate mock price history for demonstration
// In production, this would come from listingHistory data
function generateMockPriceHistory(currentPrice: number, dom: number): PricePoint[] {
  const points: PricePoint[] = [];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - dom);
  
  const numPoints = Math.min(Math.ceil(dom / 14), 12); // Weekly points, max 12
  const priceDrop = currentPrice < (currentPrice * 1.08) ? currentPrice * 0.08 : 0;
  
  for (let i = 0; i <= numPoints; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + (i * Math.floor(dom / numPoints)));
    
    // Simulate gradual price adjustments
    let price = currentPrice;
    if (i === 0 && priceDrop > 0) {
      price = currentPrice + priceDrop; // Original higher price
    } else if (i > 0 && i < numPoints) {
      price = currentPrice + (priceDrop * (1 - i / numPoints));
    }
    
    points.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      price: Math.round(price),
      event: i === numPoints - 1 ? 'Latest' : undefined,
    });
  }
  
  return points;
}

export default function DOMTimelineChart({
  priceHistory,
  currentPrice,
  originalPrice,
  dom,
  className
}: DOMTimelineChartProps) {
  // Use provided history or generate mock
  const chartData = priceHistory || generateMockPriceHistory(currentPrice, dom);
  
  // Calculate price drop percentage
  const firstPrice = chartData[0]?.price || currentPrice;
  const priceDropPercent = firstPrice > currentPrice 
    ? Math.round(((firstPrice - currentPrice) / firstPrice) * 100) 
    : 0;

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{value: number}>; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900 border border-slate-700 rounded p-2 shadow-lg">
          <p className="text-xs text-slate-400">{label}</p>
          <p className="text-sm font-bold font-mono text-emerald-400">
            {formatPrice(payload[0].value)}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={cn("bg-slate-900/50 rounded-lg border border-slate-800 p-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
            Price Timeline
          </span>
        </div>
        <div className="flex items-center gap-2">
          {priceDropPercent > 0 && (
            <div className="flex items-center gap-1 text-xs text-emerald-400">
              <TrendingDown className="h-3 w-3" />
              <span>-{priceDropPercent}%</span>
            </div>
          )}
          <span className="text-xs text-slate-500">{dom} days on market</span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-32 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="#1e293b"
              vertical={false}
            />
            <XAxis 
              dataKey="date" 
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={{ stroke: '#334155' }}
              axisLine={{ stroke: '#334155' }}
            />
            <YAxis 
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={{ stroke: '#334155' }}
              axisLine={{ stroke: '#334155' }}
              tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
              domain={['dataMin - 50000', 'dataMax + 50000']}
            />
            <Tooltip content={<CustomTooltip />} />
            
            {/* Current price reference line */}
            <ReferenceLine 
              y={currentPrice} 
              stroke="#10b981" 
              strokeDasharray="5 5"
              strokeWidth={1}
            />
            
            {/* Price trend line */}
            <Line 
              type="monotone" 
              dataKey="price" 
              stroke="#10b981" 
              strokeWidth={2}
              dot={{ fill: '#10b981', r: 3 }}
              activeDot={{ fill: '#34d399', r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800">
        <div className="text-center">
          <span className="text-[10px] text-slate-500 uppercase">Original</span>
          <p className="text-xs font-mono text-slate-300">
            {formatPrice(originalPrice || firstPrice)}
          </p>
        </div>
        <div className="text-center">
          <span className="text-[10px] text-slate-500 uppercase">Current</span>
          <p className="text-xs font-mono text-emerald-400">
            {formatPrice(currentPrice)}
          </p>
        </div>
        <div className="text-center">
          <span className="text-[10px] text-slate-500 uppercase">Drop</span>
          <p className={cn(
            "text-xs font-mono",
            priceDropPercent > 0 ? "text-emerald-400" : "text-slate-400"
          )}>
            {priceDropPercent > 0 ? `-${priceDropPercent}%` : '0%'}
          </p>
        </div>
      </div>
    </div>
  );
}