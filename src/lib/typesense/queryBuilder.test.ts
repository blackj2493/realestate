import { describe, it, expect, beforeEach } from 'vitest';
import { buildFilterQuery, buildSortQuery } from './queryBuilder';
import { useFilterStore } from '@/store/useFilterStore';

const initialState = useFilterStore.getState();

beforeEach(() => {
  // Reset zustand store to the documented defaults before every test.
  useFilterStore.setState(initialState, true);
});

describe('buildFilterQuery', () => {
  it('default state — emits the two non-saturated default filters (suiteFilters + occupancy)', () => {
    // suiteFilters defaults to 2 of 4 (PRIME_CANDIDATE, EXISTING_MULTI_UNIT) → active
    // occupancyFilter defaults to 2 of 3 (Vacant, Tenanted) → active
    // capRateFloor=0, cashflowFloor=0, taxBurdenMax=100, etc. → inactive
    const q = buildFilterQuery();
    expect(q).toContain('multi_unit_status:=');
    expect(q).toContain('occupancy_status:=');
    expect(q).not.toContain('cap_rate_floor');
    expect(q).not.toContain('tax_burden_ratio');
    expect(q).not.toContain('true_dom');
  });

  it('joins active filters with " && " (Typesense colon-operator syntax)', () => {
    useFilterStore.setState({
      capRateFloor: 5,
      cashflowFloor: 200,
      targetYieldMin: 6,
      suiteFilters: [],
      occupancyFilter: [],
    });
    const q = buildFilterQuery();
    expect(q).toBe(
      'cap_rate_floor:>=5 && net_monthly_cashflow:>=200 && gross_yield_est:>=6'
    );
  });

  it('emits empty string when no filters are active', () => {
    useFilterStore.setState({
      capRateFloor: 0,
      cashflowFloor: 0,
      targetYieldMin: 0,
      suiteFilters: [], // empty: skipped
      occupancyFilter: [], // empty: skipped
      propertyTypeFilter: 'All', // sentinel: skipped
      minParkingFilter: 0,
      taxBurdenMax: 100, // ceiling: skipped
      showOnlyDistressed: false,
      maxHoldingCostRange: [0, 10000], // unchanged: skipped
      minTrueDomRange: [0, 365],
      unfinishedBasementOnly: false,
      vacantPossessionOnly: false,
      priceDropRange: [0, 100],
    });
    expect(buildFilterQuery()).toBe('');
  });

  it('suite filter set [a,b] → emits multi_unit_status:=["a","b"]', () => {
    useFilterStore.setState({
      suiteFilters: ['PRIME_CANDIDATE', 'MARGINAL_CANDIDATE'],
      occupancyFilter: [],
    });
    expect(buildFilterQuery()).toBe(
      'multi_unit_status:=["PRIME_CANDIDATE","MARGINAL_CANDIDATE"]'
    );
  });

  it('does NOT emit a suite filter when all 4 options are selected (no-op for the user)', () => {
    useFilterStore.setState({
      suiteFilters: ['A', 'B', 'C', 'D'],
      occupancyFilter: [],
    });
    expect(buildFilterQuery()).toBe('');
  });

  it('vacant possession + unfinished basement → emits both literal lists', () => {
    useFilterStore.setState({
      suiteFilters: [],
      occupancyFilter: [],
      vacantPossessionOnly: true,
      unfinishedBasementOnly: true,
    });
    const q = buildFilterQuery();
    expect(q).toContain('basement_type:=["Unfinished"]');
    expect(q).toContain('occupant_type:=["Vacant"]');
  });

  it('range filters (holding cost, price drop) use Typesense ".." syntax', () => {
    useFilterStore.setState({
      suiteFilters: [],
      occupancyFilter: [],
      maxHoldingCostRange: [500, 3000],
      priceDropRange: [5, 25],
    });
    const q = buildFilterQuery();
    expect(q).toContain('max_holding_cost:[500..3000]');
    expect(q).toContain('true_price_drop_pct:[5..25]');
  });

  it('distressed toggle → exact 4-tag literal list (compliance/contract test)', () => {
    useFilterStore.setState({
      suiteFilters: [],
      occupancyFilter: [],
      showOnlyDistressed: true,
    });
    expect(buildFilterQuery()).toBe(
      'deal_type_flag:=["LEGAL_DISTRESS","ASSIGNMENT_SALE","FIXER_UPPER","MOTIVATED_SELLER"]'
    );
  });
});

describe('buildSortQuery', () => {
  it('appends :desc to the configured sort key', () => {
    expect(buildSortQuery()).toBe('cap_rate_floor:desc');
  });

  it('honors a custom sortBy', () => {
    useFilterStore.setState({ sortBy: 'TrueDOM' });
    expect(buildSortQuery()).toBe('TrueDOM:desc');
  });
});
