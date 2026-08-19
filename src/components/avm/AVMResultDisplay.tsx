/**
 * AVM Result Display Component
 * 
 * Right panel: Shows estimated value, adjustment breakdown, and engine metadata.
 */

'use client';

import Link from 'next/link';
import { useAVMStore } from '@/store/useAVMStore';
import type { AVMResult } from '@/lib/avm/types';
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
      <span className="text-muted-foreground dark:text-gray-400">{label}</span>
      <span className={value >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
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
          : 'bg-muted text-muted-foreground border-border dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600'
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
      <div className="flex items-center justify-center h-64 text-red-700 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground dark:text-gray-500">
        Enter property details and calculate
      </div>
    );
  }

  // Coverage guard: an untrained/unknown region (or a saturating outlier with too
  // few peers) yields no usable level — basis 'none' and/or a $0 anchor. Rendering
  // that verbatim shows "$0 · Anchor Price $0", which reads as broken. Show an
  // explicit out-of-coverage state instead (see AnchorBasis 'none' in lib/avm/types).
  if (result.basis === 'none' || result.estimatedValue <= 0 || result.anchorPrice <= 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-md border border-border bg-muted/40 p-6 text-center dark:border-gray-700 dark:bg-gray-900/40">
          <div className="text-lg font-semibold text-foreground dark:text-gray-200">Estimate unavailable</div>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground dark:text-gray-400">
            We don&apos;t have enough recent comparable sales in this area to produce a
            reliable valuation. Try a covered city/region — coverage is strongest across
            the Greater Toronto Area.
          </p>
        </div>
        <div className="space-y-2 pt-4 border-t border-border dark:border-gray-700">
          <Link
            href="/properties"
            className="flex h-12 w-full items-center justify-center rounded-md bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
          >
            See live investor deals near you →
          </Link>
          <p className="text-xs text-muted-foreground text-center dark:text-gray-500">
            Estimate only — not a formal appraisal or financial advice.
          </p>
        </div>
      </div>
    );
  }

  const adjustmentDiff = result.estimatedValue - result.anchorPrice;
  const isPositive = adjustmentDiff >= 0;

  return (
    <div className="space-y-6">
      {/* Primary Value */}
      <div className="text-center">
        {/* The headline valuation — text-white made it invisible on the light card. */}
        <div className="text-4xl font-mono font-bold text-foreground dark:text-white">
          {formatCurrency(result.estimatedValue)}
        </div>
        <div className="mt-2 flex items-center justify-center gap-3">
          <span className="text-lg text-muted-foreground dark:text-gray-400">
            {isPositive ? '↑' : '↓'} {formatCurrency(Math.abs(adjustmentDiff))}
          </span>
          <span className="text-muted-foreground dark:text-gray-500">|</span>
          <span className={isPositive ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
            {formatPct(result.totalAdjustmentPct)}
          </span>
        </div>
      </div>

      {/* Engine Metadata */}
      <div className="space-y-2">
        <EngineBadge engineMode={result.engineMode} />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground dark:text-gray-400">Anchor Price</span>
          <span className="text-foreground font-mono dark:text-gray-300">
            {formatCurrency(result.anchorPrice)}
          </span>
        </div>
        {result.r2Score !== null && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">R² Score</span>
            <span className="text-foreground font-mono dark:text-gray-300">{result.r2Score.toFixed(2)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground dark:text-gray-400">Confidence</span>
          <ConfidenceBadge confidence={result.confidence} />
        </div>
      </div>

      {/* Breakdown */}
      {result.engineMode === 'COEFFICIENT_ADJUSTED' && (
        <div className="space-y-2 pt-4 border-t border-border dark:border-gray-700">
          <Label className="text-xs text-muted-foreground dark:text-gray-400">ADJUSTMENT BREAKDOWN</Label>
          <BreakdownRow label="Bedrooms" value={result.breakdown.bedroomsAdjustment} />
          <BreakdownRow label="Den / extra room" value={result.breakdown.plusRoomAdjustment} />
          <BreakdownRow label="Bathrooms" value={result.breakdown.bathroomsAdjustment} />
          <BreakdownRow label="Parking" value={result.breakdown.parkingAdjustment} />
          <BreakdownRow label="Interior" value={result.breakdown.interiorAdjustment} />
          <BreakdownRow label="Exterior" value={result.breakdown.exteriorAdjustment} />
          <BreakdownRow label="Basement" value={result.breakdown.basementAdjustment} />
        </div>
      )}

      {/* Lead CTA — route high-intent viewer into the funnel */}
      <div className="space-y-2 pt-4 border-t border-border dark:border-gray-700">
        <Link
          href="/properties"
          className="flex h-12 w-full items-center justify-center rounded-md bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
        >
          See live investor deals near you →
        </Link>
        <p className="text-xs text-muted-foreground text-center dark:text-gray-500">
          Estimate only — not a formal appraisal or financial advice.
        </p>
      </div>
    </div>
  );
}

function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-xs text-muted-foreground uppercase tracking-wider dark:text-gray-400 ${className}`}>
      {children}
    </div>
  );
}