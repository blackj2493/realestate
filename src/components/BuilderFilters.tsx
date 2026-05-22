/**
 * BuilderFilters.tsx - UI Controls for Builder/Land Development Filters
 */

"use client";

import React, { useState, useMemo } from 'react';
import { useFilterStore } from '@/store/useFilterStore';
import { cn } from '@/lib/utils';

export default function BuilderFilters() {
  const {
    minFrontage,
    minLotSqft,
    devPlaysOnly,
    multiplexByRight,
    coveredLand,
    setMinFrontage,
    setMinLotSqft,
    setDevPlaysOnly,
    setMultiplexByRight,
    setCoveredLand,
    resetBuilderFilters,
  } = useFilterStore();

  // Unit toggle for lot size input
  const [unit, setUnit] = useState<'sqft' | 'acres'>('sqft');

  // Convert sqft to acres for display when unit is acres
  const lotSizeValue = useMemo(() => {
    if (!minLotSqft) return '';
    if (unit === 'acres') {
      return (minLotSqft / 43560).toFixed(2);
    }
    return minLotSqft.toString();
  }, [minLotSqft, unit]);

  // Convert input value to sqft based on unit
  const convertToSqFt = (value: number): number | null => {
    if (!value || isNaN(value)) return null;
    if (unit === 'acres') {
      return Math.round(value * 43560);
    }
    return value;
  };

  // Handle input changes - merge builder filter updates
  const handleChange = (updates: Partial<{
    minFrontage: number | null;
    minLotSqft: number | null;
    devPlaysOnly: boolean;
    multiplexByRight: boolean;
    coveredLand: boolean;
  }>) => {
    if (updates.minFrontage !== undefined) setMinFrontage(updates.minFrontage);
    if (updates.minLotSqft !== undefined) setMinLotSqft(updates.minLotSqft);
    if (updates.devPlaysOnly !== undefined) setDevPlaysOnly(updates.devPlaysOnly);
    if (updates.multiplexByRight !== undefined) setMultiplexByRight(updates.multiplexByRight);
    if (updates.coveredLand !== undefined) setCoveredLand(updates.coveredLand);
  };

  // Check if any builder filters are active
  const hasActiveFilters = minFrontage !== null || minLotSqft !== null || devPlaysOnly || multiplexByRight || coveredLand;

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-mono font-semibold text-cyan-400 uppercase tracking-wider">
          🏗️ Builder Filters
        </h3>
        {hasActiveFilters && (
          <button
            onClick={resetBuilderFilters}
            className="text-[10px] font-mono text-slate-500 hover:text-cyan-400 transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Filter Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Min Frontage Input */}
        <div className="relative">
          <label className="text-[10px] font-mono text-slate-400 uppercase">Min Frontage</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={minFrontage ?? ""}
              onChange={(e) => handleChange({ minFrontage: e.target.value ? parseFloat(e.target.value) : null })}
              placeholder="50"
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 focus:border-cyan-500 focus:outline-none focus:shadow-[0_0_0_1px_rgba(6,182,212,0.3)]"
            />
            <span className="text-[10px] font-mono text-slate-500">ft</span>
          </div>
        </div>

        {/* Min Lot Size Input (with unit toggle) */}
        <div className="relative">
          <label className="text-[10px] font-mono text-slate-400 uppercase">Min Lot Size</label>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={lotSizeValue}
                onChange={(e) => handleChange({ minLotSqft: convertToSqFt(parseFloat(e.target.value) || 0) })}
                placeholder="5000"
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 focus:border-cyan-500 focus:outline-none focus:shadow-[0_0_0_1px_rgba(6,182,212,0.3)]"
              />
              <span className="text-[10px] font-mono text-slate-500">{unit === 'sqft' ? 'sqft' : 'ac'}</span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setUnit('sqft')}
                className={cn(
                  "text-[9px] font-mono px-2 py-0.5 rounded transition-colors",
                  unit === 'sqft' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-500'
                )}
              >
                sqft
              </button>
              <button
                onClick={() => setUnit('acres')}
                className={cn(
                  "text-[9px] font-mono px-2 py-0.5 rounded transition-colors",
                  unit === 'acres' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-500'
                )}
              >
                acres
              </button>
              {unit === 'acres' && lotSizeValue && (
                <span className="text-[9px] font-mono text-slate-600">
                  = {Math.round(parseFloat(lotSizeValue) * 43560).toLocaleString()} sqft
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Dev Plays Only Toggle - Full Width */}
        <div className="col-span-2 flex items-center justify-between p-3 bg-slate-900/50 border border-slate-800 rounded">
          <div>
            <div className="text-xs font-mono text-slate-200">Dev Plays Only</div>
            <div className="text-[10px] font-mono text-slate-500">Severance + Covered Land</div>
          </div>
          <button
            onClick={() => handleChange({ devPlaysOnly: !devPlaysOnly })}
            className={cn(
              "w-10 h-5 rounded-full transition-colors relative",
              devPlaysOnly ? 'bg-cyan-500' : 'bg-slate-700'
            )}
          >
            <div className={cn(
              "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
              devPlaysOnly ? 'translate-x-5' : 'translate-x-0.5'
            )} />
          </button>
        </div>

        {/* Multiplex By Right Toggle */}
        <div className="flex items-center justify-between p-3 bg-slate-900/50 border border-slate-800 rounded">
          <div>
            <div className="text-xs font-mono text-slate-200">Multiplex By-Right</div>
            <div className="text-[10px] font-mono text-slate-500">No variance needed</div>
          </div>
          <button
            onClick={() => handleChange({ multiplexByRight: !multiplexByRight })}
            className={cn(
              "w-10 h-5 rounded-full transition-colors relative",
              multiplexByRight ? 'bg-cyan-500' : 'bg-slate-700'
            )}
          >
            <div className={cn(
              "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
              multiplexByRight ? 'translate-x-5' : 'translate-x-0.5'
            )} />
          </button>
        </div>

        {/* Covered Land Toggle */}
        <div className="flex items-center justify-between p-3 bg-slate-900/50 border border-slate-800 rounded">
          <div>
            <div className="text-xs font-mono text-slate-200">Covered Land</div>
            <div className="text-[10px] font-mono text-slate-500">Tear-down candidates</div>
          </div>
          <button
            onClick={() => handleChange({ coveredLand: !coveredLand })}
            className={cn(
              "w-10 h-5 rounded-full transition-colors relative",
              coveredLand ? 'bg-cyan-500' : 'bg-slate-700'
            )}
          >
            <div className={cn(
              "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
              coveredLand ? 'translate-x-5' : 'translate-x-0.5'
            )} />
          </button>
        </div>
      </div>
    </div>
  );
}