"use client";

import { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  Home,
  Hammer,
  DollarSign,
  Percent,
  DoorOpen,
  AlertTriangle,
  Bed,
  Maximize2,
  Calendar,
  Car,
  Warehouse,
  RotateCcw,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Persona types
export type PersonaType = "primary" | "yield" | "value-add";

export interface InvestorFilters {
  // Price
  minPrice: number;
  maxPrice: number;
  // Yield
  minYield: number;
  maxYield: number;
  // Boolean filters
  hasSuitePotential: boolean;
  isDistressed: boolean;
  // Bedrooms
  minBedrooms: number;
  maxBedrooms: number;
}

export interface ValueAddFilters {
  // Lot dimensions
  minLotWidth: number;
  maxLotWidth: number;
  minLotDepth: number;
  maxLotDepth: number;
  // Zoning/Basement
  hasUnfinishedBasement: boolean;
  hasDetachedGarage: boolean;
  // DOM
  minDOM: number;
  maxDOM: number;
}

interface CommandCenterSidebarProps {
  onFiltersChange?: (persona: PersonaType, investorFilters: InvestorFilters, valueAddFilters: ValueAddFilters) => void;
  className?: string;
}

const PERSONAS = [
  { id: "primary" as const, label: "Primary Residence", icon: Home },
  { id: "yield" as const, label: "Yield Investor", icon: TrendingUp },
  { id: "value-add" as const, label: "Value-Add / Developer", icon: Hammer },
];

// Numeric stepper component
function NumericStepper({
  label,
  value,
  onChange,
  min = 0,
  max = 10,
  unit = "",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  unit?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-1">
      <span className="text-xs text-slate-400 font-medium">{label}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="w-6 h-6 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-400 transition-colors"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
        <div className="w-12 text-center">
          <span className="text-sm font-mono text-slate-100">{value}</span>
          {unit && <span className="text-xs text-slate-500 ml-0.5">{unit}</span>}
        </div>
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="w-6 h-6 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-400 transition-colors"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// Toggle component
function Toggle({
  label,
  value,
  onChange,
  icon: Icon,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  icon: React.ElementType;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left",
        value
          ? "bg-emerald-900/30 border-emerald-700/50 text-emerald-300"
          : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-600"
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="text-xs font-medium flex-1">{label}</span>
      <div
        className={cn(
          "w-8 h-4 rounded-full transition-colors relative",
          value ? "bg-emerald-500" : "bg-slate-600"
        )}
      >
        <div
          className={cn(
            "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform",
            value ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </div>
    </button>
  );
}

// Range slider with dual handles
function RangeSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix = "",
  suffix = "",
  icon: Icon,
}: {
  label: string;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-3.5 w-3.5 text-slate-400" />}
          <span className="text-xs text-slate-400 font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-1 font-mono text-xs">
          <span className="text-emerald-400">{prefix}{value[0]}{suffix}</span>
          <span className="text-slate-500 mx-1">—</span>
          <span className="text-emerald-400">{prefix}{value[1]}{suffix}</span>
        </div>
      </div>
      <div className="px-1">
        <Slider
          value={value}
          onValueChange={onChange}
          min={min}
          max={max}
          step={step}
          className="w-full"
        />
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-slate-600 font-mono">{prefix}{min}{suffix}</span>
          <span className="text-[10px] text-slate-600 font-mono">{prefix}{max}{suffix}</span>
        </div>
      </div>
    </div>
  );
}

// Single slider component
function SingleSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix = "",
  suffix = "",
  icon: Icon,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-3.5 w-3.5 text-slate-400" />}
          <span className="text-xs text-slate-400 font-medium">{label}</span>
        </div>
        <span className="font-mono text-sm text-emerald-400">
          {prefix}{value}{suffix}
        </span>
      </div>
      <div className="px-1">
        <Slider
          value={[value]}
          onValueChange={([v]) => onChange(v)}
          min={min}
          max={max}
          step={step}
          className="w-full"
        />
      </div>
    </div>
  );
}

// Section header
function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-slate-800 mb-3">
      <Icon className="h-4 w-4 text-emerald-500" />
      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{title}</h3>
    </div>
  );
}

export default function CommandCenterSidebar({ onFiltersChange, className }: CommandCenterSidebarProps) {
  const [activePersona, setActivePersona] = useState<PersonaType>("yield");

  // Yield Investor Filters
  const [investorFilters, setInvestorFilters] = useState<InvestorFilters>({
    minPrice: 0,
    maxPrice: 5000000,
    minYield: 0,
    maxYield: 15,
    hasSuitePotential: false,
    isDistressed: false,
    minBedrooms: 0,
    maxBedrooms: 10,
  });

  // Value-Add Filters
  const [valueAddFilters, setValueAddFilters] = useState<ValueAddFilters>({
    minLotWidth: 0,
    maxLotWidth: 200,
    minLotDepth: 0,
    maxLotDepth: 500,
    hasUnfinishedBasement: false,
    hasDetachedGarage: false,
    minDOM: 0,
    maxDOM: 365,
  });

  // Notify parent of filter changes with 300ms debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      onFiltersChange?.(activePersona, investorFilters, valueAddFilters);
    }, 300);
    return () => clearTimeout(timer);
  }, [activePersona, investorFilters, valueAddFilters, onFiltersChange]);

  const handlePersonaChange = (persona: PersonaType) => {
    setActivePersona(persona);
  };

  return (
    <div className={cn("bg-slate-900 h-full flex flex-col", className)}>
      {/* Header */}
      <div className="p-4 border-b border-slate-800">
        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Command Center
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">Shadow MLS Filter Layer</p>
      </div>

      {/* Persona Switcher */}
      <div className="p-3 border-b border-slate-800">
        <div className="bg-slate-800 rounded-lg p-1 grid grid-cols-3 gap-1">
          {PERSONAS.map((persona) => {
            const Icon = persona.icon;
            return (
              <button
                key={persona.id}
                onClick={() => handlePersonaChange(persona.id)}
                className={cn(
                  "flex flex-col items-center gap-1 px-2 py-2 rounded-md text-xs font-medium transition-all",
                  activePersona === persona.id
                    ? "bg-emerald-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="text-center leading-tight">{persona.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {/* YIELD INVESTOR PANEL */}
        {activePersona === "yield" && (
          <div className="space-y-4">
            {/* Price Range */}
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
              <SectionHeader icon={DollarSign} title="Price Range" />
              <RangeSlider
                label="List Price"
                value={[investorFilters.minPrice, investorFilters.maxPrice]}
                onChange={([min, max]) =>
                  setInvestorFilters((f) => ({ ...f, minPrice: min, maxPrice: max }))
                }
                min={0}
                max={5000000}
                step={50000}
                prefix="$"
                icon={DollarSign}
              />
              <div className="flex gap-2 mt-2">
                <div className="flex-1">
                  <label className="text-[10px] text-slate-500 uppercase">Min</label>
                  <Input
                    type="number"
                    value={investorFilters.minPrice}
                    onChange={(e) =>
                      setInvestorFilters((f) => ({
                        ...f,
                        minPrice: parseInt(e.target.value) || 0,
                      }))
                    }
                    className="h-8 bg-slate-900 border-slate-700 text-xs font-mono text-slate-200"
                    placeholder="0"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-slate-500 uppercase">Max</label>
                  <Input
                    type="number"
                    value={investorFilters.maxPrice}
                    onChange={(e) =>
                      setInvestorFilters((f) => ({
                        ...f,
                        maxPrice: parseInt(e.target.value) || 5000000,
                      }))
                    }
                    className="h-8 bg-slate-900 border-slate-700 text-xs font-mono text-slate-200"
                    placeholder="5M"
                  />
                </div>
              </div>
            </div>

            {/* Target Yield */}
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
              <SectionHeader icon={Percent} title="Target Yield" />
              <SingleSlider
                label="Min. Gross Yield"
                value={investorFilters.minYield}
                onChange={(v) => setInvestorFilters((f) => ({ ...f, minYield: v }))}
                min={0}
                max={15}
                step={0.5}
                suffix="%"
                icon={Percent}
              />
              <div className="mt-2 grid grid-cols-4 gap-1">
                {[5, 7, 10, 12].map((threshold) => (
                  <button
                    key={threshold}
                    onClick={() => setInvestorFilters((f) => ({ ...f, minYield: threshold }))}
                    className={cn(
                      "text-xs py-1 rounded border transition-colors",
                      investorFilters.minYield === threshold
                        ? "bg-emerald-600 border-emerald-600 text-white"
                        : "border-slate-700 text-slate-400 hover:border-slate-600"
                    )}
                  >
                    {threshold}%
                  </button>
                ))}
              </div>
            </div>

            {/* Boolean Filters */}
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
              <SectionHeader icon={DoorOpen} title="Investment Signals" />
              <div className="space-y-2">
                <Toggle
                  label="Secondary Suite Potential"
                  value={investorFilters.hasSuitePotential}
                  onChange={(v) => setInvestorFilters((f) => ({ ...f, hasSuitePotential: v }))}
                  icon={DoorOpen}
                />
                <Toggle
                  label="Distressed Listings"
                  value={investorFilters.isDistressed}
                  onChange={(v) => setInvestorFilters((f) => ({ ...f, isDistressed: v }))}
                  icon={AlertTriangle}
                />
              </div>
            </div>

            {/* Bedrooms */}
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
              <SectionHeader icon={Bed} title="Bedroom Count" />
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-400">Range</span>
                <span className="font-mono text-sm text-emerald-400">
                  {investorFilters.minBedrooms} — {investorFilters.maxBedrooms}
                </span>
              </div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-500">Min</span>
                <NumericStepper
                  label=""
                  value={investorFilters.minBedrooms}
                  onChange={(v) => setInvestorFilters((f) => ({ ...f, minBedrooms: v }))}
                  min={0}
                  max={10}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Max</span>
                <NumericStepper
                  label=""
                  value={investorFilters.maxBedrooms}
                  onChange={(v) => setInvestorFilters((f) => ({ ...f, maxBedrooms: v }))}
                  min={0}
                  max={10}
                />
              </div>
            </div>
          </div>
        )}

        {/* VALUE-ADD / DEVELOPER PANEL */}
        {activePersona === "value-add" && (
          <div className="space-y-4">
            {/* Lot Size */}
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
              <SectionHeader icon={Maximize2} title="Lot Dimensions" />
              <div className="space-y-3">
                <RangeSlider
                  label="Lot Width (ft)"
                  value={[valueAddFilters.minLotWidth, valueAddFilters.maxLotWidth]}
                  onChange={([min, max]) =>
                    setValueAddFilters((f) => ({ ...f, minLotWidth: min, maxLotWidth: max }))
                  }
                  min={0}
                  max={200}
                  step={5}
                  suffix="ft"
                  icon={Maximize2}
                />
                <RangeSlider
                  label="Lot Depth (ft)"
                  value={[valueAddFilters.minLotDepth, valueAddFilters.maxLotDepth]}
                  onChange={([min, max]) =>
                    setValueAddFilters((f) => ({ ...f, minLotDepth: min, maxLotDepth: max }))
                  }
                  min={0}
                  max={500}
                  step={10}
                  suffix="ft"
                  icon={Maximize2}
                />
              </div>
            </div>

            {/* Zoning/Basement */}
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
              <SectionHeader icon={Warehouse} title="Development Potential" />
              <div className="space-y-2">
                <Toggle
                  label="Unfinished Basement"
                  value={valueAddFilters.hasUnfinishedBasement}
                  onChange={(v) => setValueAddFilters((f) => ({ ...f, hasUnfinishedBasement: v }))}
                  icon={Warehouse}
                />
                <Toggle
                  label="Detached Garage"
                  value={valueAddFilters.hasDetachedGarage}
                  onChange={(v) => setValueAddFilters((f) => ({ ...f, hasDetachedGarage: v }))}
                  icon={Car}
                />
              </div>
            </div>

            {/* Days on Market */}
            <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/30">
              <SectionHeader icon={Calendar} title="Market Timing" />
              <RangeSlider
                label="Days on Market"
                value={[valueAddFilters.minDOM, valueAddFilters.maxDOM]}
                onChange={([min, max]) =>
                  setValueAddFilters((f) => ({ ...f, minDOM: min, maxDOM: max }))
                }
                min={0}
                max={365}
                step={5}
                suffix=" days"
                icon={Calendar}
              />
              <div className="flex gap-2 mt-2">
                {[30, 60, 90, 180].map((days) => (
                  <button
                    key={days}
                    onClick={() => setValueAddFilters((f) => ({ ...f, minDOM: days }))}
                    className={cn(
                      "flex-1 text-xs py-1.5 rounded border transition-colors",
                      valueAddFilters.minDOM === days
                        ? "bg-amber-600 border-amber-600 text-white"
                        : "border-slate-700 text-slate-400 hover:border-slate-600"
                    )}
                  >
                    {days}+
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* PRIMARY RESIDENCE - Placeholder */}
        {activePersona === "primary" && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Home className="h-12 w-12 text-slate-600 mb-4" />
            <h3 className="text-sm font-medium text-slate-400 mb-2">Primary Residence</h3>
            <p className="text-xs text-slate-500">Standard search mode</p>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-3 border-t border-slate-800 space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full h-9 text-xs bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
        >
          <RotateCcw className="h-3 w-3 mr-2" />
          Reset All
        </Button>
        <div className="text-[10px] text-slate-600 text-center">
          300ms debounce on all filters
        </div>
      </div>
    </div>
  );
}