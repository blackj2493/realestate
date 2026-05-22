'use client';

import { useFilterStore } from '@/store/useFilterStore';
import { Slider } from '@/components/ui/slider';

/**
 * Shadow MLS - Flipper & Deal Hunter Filters
 * 
 * Filter bar components for the flipper persona:
 * - Max Holding Cost: dual-handle range slider
 * - Min True DOM: single slider (0-365 days)
 * - Distressed/As-Is Toggle: boolean switch
 * - Unfinished Basement Toggle: boolean switch
 * - Vacant Possession Toggle: boolean switch
 */

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  color?: 'rose' | 'amber' | 'blue';
}

function ToggleSwitch({ checked, onChange, label, color = 'rose' }: ToggleSwitchProps) {
  const colorClasses = {
    rose: checked 
      ? 'bg-rose-400/20 border-rose-400/50 text-rose-400' 
      : 'bg-slate-800 border-slate-700 text-slate-500',
    amber: checked 
      ? 'bg-amber-400/20 border-amber-400/50 text-amber-400' 
      : 'bg-slate-800 border-slate-700 text-slate-500',
    blue: checked 
      ? 'bg-blue-400/20 border-blue-400/50 text-blue-400' 
      : 'bg-slate-800 border-slate-700 text-slate-500',
  };

  return (
    <button
      onClick={() => onChange(!checked)}
      className={`
        flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded
        border transition-all ${colorClasses[color]}
      `}
    >
      <span>{label}</span>
      <span className="text-lg leading-none">
        {checked ? '●' : '○'}
      </span>
    </button>
  );
}

export function FlipperFilters() {
  const store = useFilterStore();

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-slate-900 border-b border-slate-800">
      {/* Distressed/As-Is Toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-slate-400">DEAL</span>
        <ToggleSwitch
          checked={store.showOnlyDistressed}
          onChange={store.setShowOnlyDistressed}
          label="Distressed"
          color="rose"
        />
      </div>

      {/* Divider */}
      <div className="h-6 w-px bg-slate-700" />

      {/* Max Holding Cost Range - Dual Handle Slider */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-slate-400">HOLD ≤</span>
        <div className="w-32">
          <Slider
            value={store.maxHoldingCostRange}
            min={0}
            max={10000}
            step={100}
            onValueChange={store.setMaxHoldingCostRange}
          />
        </div>
        <span className="text-xs font-mono text-rose-400 w-20 text-right">
          ${store.maxHoldingCostRange[0]}-${store.maxHoldingCostRange[1]}
        </span>
      </div>

      {/* Min True DOM - Single Handle Slider */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-slate-400">DOM ≥</span>
        <div className="w-24">
          <Slider
            value={[store.minTrueDomRange[0]]}
            min={0}
            max={365}
            step={5}
            onValueChange={([v]) => store.setMinTrueDomRange([v, 365])}
          />
        </div>
        <span className="text-xs font-mono text-slate-300 w-12">
          {store.minTrueDomRange[0]}
        </span>
      </div>

      {/* Price Drop Range - Dual Handle Slider */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-slate-400">DROP ≥</span>
        <div className="w-24">
          <Slider
            value={store.priceDropRange}
            min={0}
            max={100}
            step={1}
            onValueChange={store.setPriceDropRange}
          />
        </div>
        <span className="text-xs font-mono text-emerald-400 w-12">
          {store.priceDropRange[0]}%
        </span>
      </div>

      {/* Divider */}
      <div className="h-6 w-px bg-slate-700" />

      {/* Property Condition Toggles */}
      <div className="flex items-center gap-1">
        <span className="text-xs font-mono text-slate-400 mr-1">COND</span>
        <ToggleSwitch
          checked={store.unfinishedBasementOnly}
          onChange={store.setUnfinishedBasementOnly}
          label="Unfin. Bsmt"
          color="amber"
        />
        <ToggleSwitch
          checked={store.vacantPossessionOnly}
          onChange={store.setVacantPossessionOnly}
          label="Vacant"
          color="blue"
        />
      </div>
    </div>
  );
}

export default FlipperFilters;