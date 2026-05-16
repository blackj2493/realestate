/**
 * TopCommandBar - Persona selector and Smart Homebuyer filters
 * Part of the Command Center 100vh interface
 */

"use client";

import React from 'react';
import { 
  Home, 
  TrendingUp, 
  Hammer, 
  Search,
  SlidersHorizontal,
  X,
  ChevronDown,
  DollarSign,
  Calendar,
  Building2,
  ShieldAlert,
  Ban,
  HomeIcon
} from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { 
  useCommandCenterStore, 
  type PersonaType, 
  type CapExRisk,
  type SmartHomebuyerFilters 
} from '@/lib/stores/commandCenterStore';

// ============================================================================
// Types
// ============================================================================

interface TopCommandBarProps {
  className?: string;
}

// ============================================================================
// Persona Configuration
// ============================================================================

const PERSONAS: { id: PersonaType; label: string; icon: React.ElementType }[] = [
  { id: 'cashflow', label: 'Cashflow Investor', icon: DollarSign },
  { id: 'builders', label: 'Builders & Developers', icon: Hammer },
  { id: 'flippers', label: 'Flippers & Deal Hunters', icon: TrendingUp },
  { id: 'smart', label: 'Smart Homebuyer', icon: Home },
];

// ============================================================================
// Component
// ============================================================================

export default function TopCommandBar({ className }: TopCommandBarProps) {
  const {
    activePersona,
    setActivePersona,
    smartFilters,
    updateSmartFilter,
    location,
    setLocation,
    isLoading,
    totalCount,
  } = useCommandCenterStore();

  // Local state for search input
  const [searchValue, setSearchValue] = React.useState(location);

  // Handle search submit
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setLocation(searchValue);
  };

  // Clear search
  const clearSearch = () => {
    setSearchValue('');
    setLocation('');
  };

  return (
    <div className={cn(
      "bg-slate-950 border-b border-slate-800",
      className
    )}>
      {/* Main Bar */}
      <div className="flex items-center px-4 py-2 gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="h-8 w-8 rounded-lg bg-emerald-600 flex items-center justify-center">
            <span className="text-white font-bold text-xs">PP</span>
          </div>
          <span className="text-lg font-bold text-slate-100 hidden md:block">PureProperty</span>
        </div>

        <div className="h-6 w-px bg-slate-800" />

        {/* Persona Selector */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">MODE:</span>
          <Select 
            value={activePersona} 
            onValueChange={(value) => setActivePersona(value as PersonaType)}
          >
            <SelectTrigger className="h-8 bg-slate-900 border-slate-700 text-xs font-medium w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700">
              {PERSONAS.map((persona) => {
                const Icon = persona.icon;
                return (
                  <SelectItem 
                    key={persona.id} 
                    value={persona.id}
                    className={cn(
                      "text-xs",
                      activePersona === persona.id && "text-emerald-400"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5" />
                      {persona.label}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="h-6 w-px bg-slate-800" />

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search city, neighborhood, or postal code..."
              className="h-9 pl-10 pr-10 bg-slate-900 border-slate-700 text-sm text-slate-200 placeholder:text-slate-500"
            />
            {searchValue && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </form>

        {/* Results Count */}
        <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 shrink-0">
          {isLoading ? (
            <span className="text-emerald-400">SCANNING...</span>
          ) : (
            <>
              <span className="font-mono text-emerald-400 font-semibold">{totalCount.toLocaleString()}</span>
              <span className="text-slate-500">ASSETS</span>
            </>
          )}
        </div>

        {/* Filter Toggle */}
        <Button 
          variant="ghost" 
          size="sm"
          className="h-8 text-xs text-slate-400 hover:text-slate-200"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
          Filters
        </Button>
      </div>

      {/* Smart Homebuyer Filter Row */}
      {activePersona === 'smart' && (
        <div className="flex items-center gap-6 px-4 py-2 border-t border-slate-800/50 bg-slate-900/30">
          {/* Max True Carry Cost */}
          <div className="flex items-center gap-2 shrink-0">
            <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Max Carry:</span>
            <div className="w-32">
              <Slider
                value={[smartFilters.maxCarryCost]}
                onValueChange={([value]) => updateSmartFilter('maxCarryCost', value)}
                min={500}
                max={10000}
                step={100}
                className="w-full"
              />
            </div>
            <span className="text-xs font-mono text-emerald-400 w-16 text-right">
              ${smartFilters.maxCarryCost.toLocaleString()}
            </span>
          </div>

          <div className="h-5 w-px bg-slate-700" />

          {/* True DOM Range Slider */}
          <div className="flex items-center gap-2 shrink-0">
            <Calendar className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">DOM:</span>
            <div className="w-32">
              <Slider
                value={[smartFilters.trueDOMMin, smartFilters.trueDOMMax]}
                onValueChange={([min, max]) => {
                  updateSmartFilter('trueDOMMin', min);
                  updateSmartFilter('trueDOMMax', max);
                }}
                min={0}
                max={365}
                step={10}
                className="w-full"
              />
            </div>
            <span className="text-xs font-mono text-amber-400 w-16 text-right">
              {smartFilters.trueDOMMin}-{smartFilters.trueDOMMax}d
            </span>
          </div>

          <div className="h-5 w-px bg-slate-700" />

          {/* Suite Status Dropdown */}
          <div className="flex items-center gap-2 shrink-0">
            <HomeIcon className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Suite:</span>
            <Select 
              value={smartFilters.suiteFilter} 
              onValueChange={(value) => updateSmartFilter('suiteFilter', value as SmartHomebuyerFilters['suiteFilter'])}
            >
              <SelectTrigger className="h-7 bg-slate-800 border-slate-700 text-xs w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                <SelectItem value="ALL" className="text-xs">All Properties</SelectItem>
                <SelectItem value="POTENTIAL_CANDIDATE" className="text-xs">Suite Candidate</SelectItem>
                <SelectItem value="EXISTING_SUITE" className="text-xs">Existing Suite</SelectItem>
                <SelectItem value="NONE" className="text-xs">No Suite Potential</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="h-5 w-px bg-slate-700" />

          {/* Mortgage Helper Toggle */}
          <button
            onClick={() => updateSmartFilter('mortgageHelperEnabled', !smartFilters.mortgageHelperEnabled)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md border transition-all text-xs font-medium",
              smartFilters.mortgageHelperEnabled
                ? "bg-emerald-900/30 border-emerald-600/50 text-emerald-300"
                : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
            )}
          >
            <Building2 className="h-3.5 w-3.5" />
            Mortgage Helper
            <div className={cn(
              "w-1.5 h-1.5 rounded-full",
              smartFilters.mortgageHelperEnabled ? "bg-emerald-400" : "bg-slate-600"
            )} />
          </button>

          <div className="h-5 w-px bg-slate-700" />

          {/* CapEx Risk Dropdown */}
          <div className="flex items-center gap-2 shrink-0">
            <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">CapEx:</span>
            <Select 
              value={smartFilters.capExRisk} 
              onValueChange={(value) => updateSmartFilter('capExRisk', value as CapExRisk)}
            >
              <SelectTrigger className="h-7 bg-slate-800 border-slate-700 text-xs w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                <SelectItem value="move-in-ready" className="text-xs">
                  Move-In Ready
                </SelectItem>
                <SelectItem value="light-tlc" className="text-xs">
                  Light TLC
                </SelectItem>
                <SelectItem value="major-work" className="text-xs">
                  Major Work
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="h-5 w-px bg-slate-700" />

          {/* Bidding War Excluder Toggle */}
          <button
            onClick={() => updateSmartFilter('biddingWarExclude', !smartFilters.biddingWarExclude)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md border transition-all text-xs font-medium",
              smartFilters.biddingWarExclude
                ? "bg-amber-900/30 border-amber-600/50 text-amber-300"
                : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200"
            )}
          >
            <Ban className="h-3.5 w-3.5" />
            No Bidding Wars
            <div className={cn(
              "w-1.5 h-1.5 rounded-full",
              smartFilters.biddingWarExclude ? "bg-amber-400" : "bg-slate-600"
            )} />
          </button>

          {/* Status Indicator */}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">LIVE</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}