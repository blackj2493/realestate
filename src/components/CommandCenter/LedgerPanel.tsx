/**
 * LedgerPanel - Right panel high-density data grid
 * Shows scrollable list of property rows with HUD styling
 */

"use client";

import React from 'react';
import { 
  Loader2,
  MapPin,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import LedgerRow from './LedgerRow';
import { useCommandCenterStore } from '@/lib/stores/commandCenterStore';
import type { ListingDocument } from '@/lib/typesense/client';

interface LedgerPanelProps {
  className?: string;
}

// Column header configuration
const COLUMN_HEADERS = [
  { label: 'ASSET', className: 'flex-1 min-w-0' },
  { label: 'SPECS', className: 'hidden md:block w-24 shrink-0 text-center' },
  { label: 'CARRY', className: 'hidden lg:block w-20 shrink-0 text-right' },
  { label: 'DOM', className: 'hidden sm:block w-14 shrink-0 text-right' },
  { label: 'FLAGS', className: 'hidden xl:block w-[180px] shrink-0' },
  { label: 'PRICE', className: 'w-28 shrink-0 text-right' },
  { label: '', className: 'w-6 shrink-0' },
];

export default function LedgerPanel({ className }: LedgerPanelProps) {
  const {
    searchResult,
    isLoading,
    error,
    totalCount,
    selectedProperty,
    setSelectedProperty,
    location,
  } = useCommandCenterStore();

  const properties = searchResult?.listings || [];

  return (
    <div className={cn(
      "flex flex-col bg-slate-950 border-l border-slate-800 h-full",
      className
    )}>
      {/* Column Headers */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-slate-800 bg-slate-900/50 shrink-0">
        {COLUMN_HEADERS.map((header, index) => (
          <div 
            key={index} 
            className={cn(
              "text-[10px] uppercase tracking-wider font-semibold text-slate-500",
              header.className
            )}
          >
            {header.label}
          </div>
        ))}
      </div>

      {/* Property List */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 text-emerald-400 animate-spin mb-3" />
            <span className="text-sm text-slate-400">SCANNING MARKET DATA...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <AlertCircle className="h-8 w-8 text-rose-400 mb-3" />
            <span className="text-sm text-rose-400 mb-1">Search Error</span>
            <span className="text-xs text-slate-500 text-center">{error}</span>
          </div>
        ) : properties.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <MapPin className="h-8 w-8 text-slate-700 mb-3" />
            <span className="text-sm text-slate-400 mb-1">No Assets Found</span>
            <span className="text-xs text-slate-500">
              {location ? `No properties in ${location}` : 'Adjust your filters to expand search'}
            </span>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/50">
            {properties.map((property) => (
              <LedgerRow
                key={property.id}
                property={property}
                onClick={() => setSelectedProperty(property)}
                isSelected={selectedProperty?.id === property.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="px-3 py-2 border-t border-slate-800 bg-slate-900/50 shrink-0">
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>
            {isLoading ? 'Scanning...' : `${totalCount.toLocaleString()} assets loaded`}
          </span>
          <span className="font-mono">
            PROPTX MLS® | T:{new Date().toLocaleTimeString('en-US', { hour12: false })}
          </span>
        </div>
      </div>
    </div>
  );
}