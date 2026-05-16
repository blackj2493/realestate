import { useFilterStore } from '@/store/useFilterStore';

export function buildFilterQuery(): string {
  const state = useFilterStore.getState();
  const filters: string[] = [];

  if (state.capRateFloor > 0) {
    filters.push(`cap_rate_floor:>=${state.capRateFloor}`);
  }
  if (state.cashflowFloor !== 0) {
    filters.push(`net_monthly_cashflow:>=${state.cashflowFloor}`);
  }
  if (state.targetYieldMin > 0) {
    filters.push(`gross_yield_est:>=${state.targetYieldMin}`);
  }
  if (state.suiteFilters.length > 0 && state.suiteFilters.length < 4) {
    filters.push(`multi_unit_status:=["${state.suiteFilters.join('","')}"]`);
  }
  if (state.occupancyFilter.length > 0 && state.occupancyFilter.length < 3) {
    filters.push(`occupancy_status:=["${state.occupancyFilter.join('","')}"]`);
  }
  if (state.propertyTypeFilter !== 'All') {
    filters.push(`property_type:=${state.propertyTypeFilter}`);
  }
  if (state.minParkingFilter > 0) {
    filters.push(`surplus_parking_count:>=${state.minParkingFilter}`);
  }
  if (state.taxBurdenMax < 100) {
    filters.push(`tax_burden_ratio:<=${state.taxBurdenMax}`);
  }

  return filters.join(' && ');
}

export function buildSortQuery(): string {
  const { sortBy } = useFilterStore.getState();
  return `${sortBy}:desc`;
}