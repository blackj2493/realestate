'use client';

import { useFilterStore } from '@/store/useFilterStore';
import { Slider } from '@/components/ui/slider';

const SUITE_OPTIONS = [
  { value: 'PRIME_CANDIDATE', label: 'Prime', color: 'emerald' },
  { value: 'EXISTING_MULTI_UNIT', label: 'Existing', color: 'blue' },
  { value: 'MARGINAL_CANDIDATE', label: 'Marginal', color: 'amber' },
  { value: 'NOT_VIABLE', label: 'None', color: 'zinc' },
];

const OCCUPANCY_OPTIONS = [
  { value: 'Vacant', label: 'Vacant', color: 'amber' },
  { value: 'Tenanted', label: 'Tenanted', color: 'blue' },
];

export function TerminalFilters() {
  const store = useFilterStore();

  return (
    <div className="flex items-center gap-6 px-4 py-2 bg-slate-900 border-b border-slate-800">
      {/* Cap Rate Floor */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-slate-400">CAP ≥</span>
        <div className="w-24">
          <Slider
            value={[store.capRateFloor]}
            min={0}
            max={12}
            step={0.25}
            onValueChange={([v]) => store.setCapRateFloor(v)}
          />
        </div>
        <span className="text-xs font-mono text-slate-300 w-12">{store.capRateFloor}%</span>
      </div>

      {/* Cashflow Floor */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-slate-400">CF ≥</span>
        <div className="w-24">
          <Slider
            value={[Math.abs(store.cashflowFloor)]}
            min={0}
            max={5000}
            step={50}
            onValueChange={([v]) => store.setCashflowFloor(v)}
          />
        </div>
        <span className="text-xs font-mono text-slate-300">${store.cashflowFloor}</span>
      </div>

      {/* Yield Min */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-slate-400">YLD ≥</span>
        <div className="w-24">
          <Slider
            value={[store.targetYieldMin]}
            min={0}
            max={12}
            step={0.25}
            onValueChange={([v]) => store.setTargetYieldMin(v)}
          />
        </div>
        <span className="text-xs font-mono text-slate-300 w-12">{store.targetYieldMin}%</span>
      </div>

      {/* Divider */}
      <div className="h-6 w-px bg-slate-700" />

      {/* Suite Status Multi-Toggle */}
      <div className="flex items-center gap-1">
        <span className="text-xs font-mono text-slate-400 mr-1">SUITE</span>
        {SUITE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => store.toggleSuiteFilter(opt.value)}
            className={`px-2 py-1 text-xs font-mono rounded transition-all ${
              store.suiteFilters.includes(opt.value)
                ? opt.color === 'emerald' ? 'bg-emerald-400/20 text-emerald-400 border border-emerald-400/30'
                : opt.color === 'blue' ? 'bg-blue-400/20 text-blue-400 border border-blue-400/30'
                : opt.color === 'amber' ? 'bg-amber-400/20 text-amber-400 border border-amber-400/30'
                : 'bg-zinc-400/20 text-zinc-400 border border-zinc-400/30'
                : 'bg-slate-800 text-slate-500 border border-slate-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Occupancy Toggle */}
      <div className="flex items-center gap-1">
        <span className="text-xs font-mono text-slate-400 mr-1">OCC</span>
        {OCCUPANCY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => store.toggleOccupancyFilter(opt.value)}
            className={`px-2 py-1 text-xs font-mono rounded transition-all ${
              store.occupancyFilter.includes(opt.value)
                ? opt.color === 'amber' ? 'bg-amber-400/20 text-amber-400 border border-amber-400/30'
                : 'bg-blue-400/20 text-blue-400 border border-blue-400/30'
                : 'bg-slate-800 text-slate-500 border border-slate-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Min Parking */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-slate-400">PARK +</span>
        <div className="w-20">
          <Slider
            value={[store.minParkingFilter]}
            min={0}
            max={6}
            step={1}
            onValueChange={([v]) => store.setMinParkingFilter(v)}
          />
        </div>
        <span className="text-xs font-mono text-emerald-400">{store.minParkingFilter}</span>
      </div>

      {/* Property Type */}
      <select
        value={store.propertyTypeFilter}
        onChange={(e) => store.setPropertyTypeFilter(e.target.value)}
        className="bg-slate-900 border border-slate-700 text-slate-300 text-xs font-mono px-2 py-1 rounded"
      >
        <option value="All">All Types</option>
        <option value="Freehold">Freehold</option>
        <option value="Condo">Condo</option>
      </select>

      {/* Sort */}
      <select
        value={store.sortBy}
        onChange={(e) => store.setSortBy(e.target.value)}
        className="bg-slate-900 border border-slate-700 text-slate-300 text-xs font-mono px-2 py-1 rounded"
      >
        <option value="cap_rate_floor">Sort: Cap Rate</option>
        <option value="net_monthly_cashflow">Sort: Cashflow</option>
        <option value="gross_yield_est">Sort: Yield</option>
        <option value="TrueDOM">Sort: True DOM</option>
      </select>
    </div>
  );
}