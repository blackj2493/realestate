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

  // ─── Flipper & Deal Hunter Filters ─────────────────────────────────────
  
  // showOnlyDistressed → deal_type_flag:=[LEGAL_DISTRESS,ASSIGNMENT_SALE,FIXER_UPPER,MOTIVATED_SELLER]
  if (state.showOnlyDistressed) {
    filters.push(`deal_type_flag:=["LEGAL_DISTRESS","ASSIGNMENT_SALE","FIXER_UPPER","MOTIVATED_SELLER"]`);
  }
  
  // maxHoldingCostRange → max_holding_cost:[min..max]
  if (state.maxHoldingCostRange[0] > 0 || state.maxHoldingCostRange[1] < 10000) {
    filters.push(`max_holding_cost:[${state.maxHoldingCostRange[0]}..${state.maxHoldingCostRange[1]}]`);
  }
  
  // minTrueDomRange → true_dom:=[min..]
  if (state.minTrueDomRange[0] > 0) {
    filters.push(`true_dom:>=${state.minTrueDomRange[0]}`);
  }
  
  // unfinishedBasementOnly → basement:=[Unfinished]
  if (state.unfinishedBasementOnly) {
    filters.push(`basement_type:=["Unfinished"]`);
  }
  
  // vacantPossessionOnly → occupant_type:=[Vacant]
  if (state.vacantPossessionOnly) {
    filters.push(`occupant_type:=["Vacant"]`);
  }
  
  // priceDropRange → true_price_drop_pct:[min..max]
  if (state.priceDropRange[0] > 0 || state.priceDropRange[1] < 100) {
    filters.push(`true_price_drop_pct:[${state.priceDropRange[0]}..${state.priceDropRange[1]}]`);
  }

  return filters.join(' && ');
}

export function buildSortQuery(): string {
  const { sortBy } = useFilterStore.getState();
  return `${sortBy}:desc`;
}