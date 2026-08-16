/**
 * BuilderColumns - Vertical stack of land/builder property metrics
 * Displays price per sqft, lot dimensions, utilities, zoning, and density potential
 */

"use client";

import React from 'react';
import { 
  formatPricePerSqFt, 
  formatLotDimensions, 
  formatUtilityStatus,
  type BuilderPropertyMetadata,
  type UtilityStatus,
  type DensityPotential
} from '@/types/builder';
import { cn } from '@/lib/utils';

interface BuilderColumnsProps {
  metadata: BuilderPropertyMetadata;
  purchasePrice?: number;
  landAreaSqFt?: number;
}

// Skeleton placeholder when metadata is null
function BuilderColumnsSkeleton() {
  return (
    <div className="border border-border rounded-md bg-card p-3 dark:border-slate-700 dark:bg-slate-900/50 space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-5 bg-muted animate-pulse rounded dark:bg-slate-800" />
      ))}
    </div>
  );
}

// Format utility status with fallback
function formatUtility(status: UtilityStatus | undefined | null): string {
  if (!status) return '—';
  return formatUtilityStatus(status);
}

// Get density display text and color
function getDensityDisplay(density: DensityPotential, severanceCandidate: boolean) {
  if (severanceCandidate) {
    return { text: '✂ Severance Ready', color: 'text-emerald-700 dark:text-emerald-400', bgColor: 'bg-emerald-500/10' };
  }
  
  switch (density) {
    case 'high':
      return { text: '⚡ High Density', color: 'text-emerald-700 dark:text-emerald-400', bgColor: 'bg-emerald-500/10' };
    case 'medium':
      return { text: '⚡ Medium Density', color: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-500/10' };
    case 'low':
      return { text: '○ Low Density', color: 'text-slate-600 dark:text-slate-400', bgColor: 'bg-slate-500/10' };
    case 'none':
    default:
      return { text: '— No Density', color: 'text-muted-foreground dark:text-slate-500', bgColor: 'bg-muted dark:bg-slate-800/50' };
  }
}

export default function BuilderColumns({ metadata, purchasePrice, landAreaSqFt }: BuilderColumnsProps) {
  // Show skeleton if metadata is null
  if (!metadata) {
    return <BuilderColumnsSkeleton />;
  }

  // Calculate price per sqft
  let pricePerSqFtDisplay: string;
  if (metadata.pricePerSqFt !== null) {
    pricePerSqFtDisplay = formatPricePerSqFt(metadata.pricePerSqFt, 1); // Already calculated
  } else if (purchasePrice && landAreaSqFt) {
    pricePerSqFtDisplay = formatPricePerSqFt(purchasePrice, landAreaSqFt);
  } else {
    pricePerSqFtDisplay = 'N/A';
  }

  // Format lot dimensions
  const lotDimensionsDisplay = metadata.lotDimensions 
    ? formatLotDimensions(metadata.lotDimensions) 
    : '—';

  // Sewer and water status
  const sewerDisplay = formatUtility(metadata.sewerStatus);
  const waterDisplay = formatUtility(metadata.waterStatus);

  // Zoning designation
  const zoningDisplay = metadata.zoningDesignation || 'N/A';
  const isMultiplexByRight = metadata.multiplexByRight;

  // Density potential
  const densityDisplay = getDensityDisplay(metadata.densityPlayPotential, metadata.severanceCandidate);

  return (
    <div className="border border-border rounded-md bg-card p-3 dark:border-slate-700 dark:bg-slate-900/50">
      {/* Row 1: Price Per SqFt */}
      <div className="flex items-center gap-2 py-1.5 border-b border-border last:border-b-0 dark:border-slate-800/50">
        <span className="text-[11px] text-muted-foreground w-16 shrink-0 dark:text-slate-500">Price</span>
        <span className={cn(
          "text-[13px] font-medium font-mono",
          pricePerSqFtDisplay !== 'N/A'
            ? "text-foreground dark:text-slate-200"
            : "text-muted-foreground dark:text-slate-500"
        )}>
          {pricePerSqFtDisplay}
        </span>
      </div>

      {/* Row 2: Lot Dimensions */}
      <div className="flex items-center gap-2 py-1.5 border-b border-border last:border-b-0 dark:border-slate-800/50">
        <span className="text-[11px] text-muted-foreground w-16 shrink-0 dark:text-slate-500">Lot</span>
        <span className="text-[13px] font-medium font-mono text-foreground dark:text-slate-200">
          {lotDimensionsDisplay}
        </span>
      </div>

      {/* Row 3: Sewer & Water */}
      <div className="flex items-center gap-2 py-1.5 border-b border-border last:border-b-0 dark:border-slate-800/50">
        <span className="text-[11px] text-muted-foreground w-16 shrink-0 dark:text-slate-500">Utilities</span>
        <div className="flex items-center gap-3 text-[13px]">
          <span>
            <span className="text-slate-500">Sewer:</span>{' '}
            <span className={cn(
              "font-medium",
              sewerDisplay === '—'
                ? "text-muted-foreground dark:text-slate-600"
                : "text-foreground dark:text-slate-300"
            )}>
              {sewerDisplay}
            </span>
          </span>
          <span>
            <span className="text-slate-500">Water:</span>{' '}
            <span className={cn(
              "font-medium",
              waterDisplay === '—'
                ? "text-muted-foreground dark:text-slate-600"
                : "text-foreground dark:text-slate-300"
            )}>
              {waterDisplay}
            </span>
          </span>
        </div>
      </div>

      {/* Row 4: Zoning */}
      <div className="flex items-center gap-2 py-1.5 border-b border-border last:border-b-0 dark:border-slate-800/50">
        <span className="text-[11px] text-muted-foreground w-16 shrink-0 dark:text-slate-500">Zone</span>
        <span className={cn(
          "text-[13px] font-medium",
          isMultiplexByRight
            ? "text-emerald-700 font-semibold dark:text-emerald-400"
            : "text-foreground dark:text-slate-200"
        )}>
          {zoningDisplay}
        </span>
      </div>

      {/* Row 5: Severance/Density */}
      <div className="flex items-center gap-2 py-1.5 border-b border-border last:border-b-0 dark:border-slate-800/50">
        <span className="text-[11px] text-muted-foreground w-16 shrink-0 dark:text-slate-500">Density</span>
        <span className={cn(
          "text-[13px] font-medium px-2 py-0.5 rounded",
          densityDisplay.bgColor,
          densityDisplay.color
        )}>
          {densityDisplay.text}
        </span>
      </div>
    </div>
  );
}