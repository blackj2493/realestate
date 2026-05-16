/**
 * AVM Result Display Component
 * 
 * Right panel: Shows estimated value, adjustment breakdown, and engine metadata.
 */

'use client';

import { useAVMStore } from '@/store/useAVMStore';
import type { AVMResult } from '@/lib/avm/types';
import { Card } from '@/components/ui/card';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPct(value: number): string {
  const pct = value * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

interface BreakdownRowProps {
  label: string;
  value: number;
}

function BreakdownRow({ label, value }: BreakdownRowProps) {
  const sign = value >= 0 ? '+' : '';
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={value >= 0 ? 'text-green-400' : 'text-red-400'}>
        {sign}
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: AVMResult['confidence'] }) {
  const colors = {
    HIGH: 'bg-green-900 text-green-300 border-green-700',
    MEDIUM: 'bg-yellow-900 text-yellow-300 border-yellow-700',
    LOW: 'bg-red-900 text-red-300 border-red-700',
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 border rounded ${colors[confidence]}`}
    >
      {confidence}
    </span>
  );
}

function EngineBadge({ engineMode }: { engineMode: AVMResult['engineMode'] }) {
  const isCoefficient = engineMode === 'COEFFICIENT_ADJUSTED';
  return (
    <span
      className={`text-xs px-2 py-0.5 border rounded ${
        isCoefficient
          ? 'bg-blue-900 text-blue-300 border-blue-700'
          : 'bg-gray-700 text-gray-300 border-gray-600'
      }`}
    >
      {isCoefficient ? 'COEFFICIENT ENGINE' : 'FALLBACK'}
    </span>
  );
}

export function AVMResultDisplay() {
  const { result, isLoading, error } = useAVMStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400">
        {error}
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Enter property details and calculate
      </div>
    );
  }

  const adjustmentDiff = result.estimatedValue - result.anchorPrice;
  const isPositive = adjustmentDiff >= 0;

  return (
    <div className="space-y-6">
      {/* Primary Value */}
      <div className="text-center">
        <div className="text-4xl font-mono font-bold text-white">
          {formatCurrency(result.estimatedValue)}
        </div>
        <div className="mt-2 flex items-center justify-center gap-3">
          <span className="text-lg text-gray-400">
            {isPositive ? '↑' : '↓'} {formatCurrency(Math.abs(adjustmentDiff))}
          </span>
          <span className="text-gray-500">|</span>
          <span className={isPositive ? 'text-green-400' : 'text-red-400'}>
            {formatPct(result.totalAdjustmentPct)}
          </span>
        </div>
      </div>

      {/* Engine Metadata */}
      <div className="space-y-2">
        <EngineBadge engineMode={result.engineMode} />
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Anchor Price</span>
          <span className="text-gray-300 font-mono">
            {formatCurrency(result.anchorPrice)}
          </span>
        </div>
        {result.r2Score !== null && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">R² Score</span>
            <span className="text-gray-300 font-mono">{result.r2Score.toFixed(2)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Confidence</span>
          <ConfidenceBadge confidence={result.confidence} />
        </div>
      </div>

      {/* Breakdown */}
      {result.engineMode === 'COEFFICIENT_ADJUSTED' && (
        <div className="space-y-2 pt-4 border-t border-gray-700">
          <Label className="text-xs text-gray-400">ADJUSTMENT BREAKDOWN</Label>
          <BreakdownRow label="Bedrooms" value={result.breakdown.bedroomsAdjustment} />
          <BreakdownRow label="Bathrooms" value={result.breakdown.bathroomsAdjustment} />
          <BreakdownRow label="Parking" value={result.breakdown.parkingAdjustment} />
          <BreakdownRow label="Interior" value={result.breakdown.interiorAdjustment} />
          <BreakdownRow label="Exterior" value={result.breakdown.exteriorAdjustment} />
          <BreakdownRow label="Basement" value={result.breakdown.basementAdjustment} />
        </div>
      )}
    </div>
  );
}

function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-xs text-gray-400 uppercase tracking-wider ${className}`}>
      {children}
    </div>
  );
}