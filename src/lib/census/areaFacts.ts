/**
 * Area facts — the numbers the listing page's "The area" card shows, built from Census 2021
 * Profile counts (characteristics.ts). Pure: the loader (scripts/worker/census/loadCensus.ts)
 * runs it offline and stores the result in census_da_area.facts; the page only reads.
 *
 * POOLING. One dissemination area (DA) is ~400-700 people, and most rows here are 25% sample
 * data that StatCan rounds and suppresses for small areas. So a listing's "here" is its DA
 * plus up to 4 nearest DAs in the same city (census subdivision): ~2,000-3,000 people. Counts
 * are summed; a ratio uses only DAs where both its numerator and its denominator were
 * published, so one suppressed DA cannot bias the share.
 *
 * Facts about PLACES only (housing, tenure, costs, commute, moves, income). See
 * characteristics.ts for the protected-ground exclusions.
 */
import { C, INCOME_GROUPS } from "./characteristics";

/** One geography's profile rows: characteristic id → [count, rate]. */
export type ProfileValues = Record<number, [number | null, number | null] | undefined>;

export interface AreaStats {
  /** Private households in the tenure count (the base for most shares). */
  households: number | null;
  rentPct: number | null;
  ownPct: number | null;
  /** People who lived at a different address 5 years earlier. */
  moved5Pct: number | null;
  /** Dwellings that are apartments (duplex flats, low-rise and high-rise). */
  aptPct: number | null;
  bed3PlusPct: number | null;
  builtBefore1981Pct: number | null;
  /** Commuters who take transit, walk or bike. */
  transitWalkBikePct: number | null;
  drivePct: number | null;
  medianCommuteMin: number | null;
  /** Tenant households that spend 30% or more of income on shelter. */
  tenantCostBurdenPct: number | null;
  /** Median total household income in 2020, interpolated from the income groups. */
  medianIncome: number | null;
}

export interface AreaFacts {
  v: 1;
  here: AreaStats;
  /** The census subdivision (the city or town) the block is in. */
  city: AreaStats;
  cityName: string;
  /** DAs pooled into `here`, and their 2021 population. */
  das: number;
  pop: number | null;
  /** Household counts per INCOME_GROUPS entry (pooled), for the rent check. */
  incomeGroups: number[];
}

/**
 * Fewer households/workers than this in a pool → the share is not shown. StatCan rounds
 * every count to a multiple of 5, so a base under ~100 swings a share by 5+ points.
 */
export const MIN_BASE = 100;

const count = (v: ProfileValues, id: number): number | null => v[id]?.[0] ?? null;
const rate = (v: ProfileValues, id: number): number | null => v[id]?.[1] ?? null;

/** Sum of counts over DAs where every id in `num` and the `den` id were published. */
function pooledShare(das: ProfileValues[], num: number[], den: number): number | null {
  let n = 0;
  let d = 0;
  for (const v of das) {
    const dv = count(v, den);
    const nv = num.map((id) => count(v, id));
    if (dv == null || dv <= 0 || nv.some((x) => x == null)) continue;
    n += (nv as number[]).reduce((a, b) => a + b, 0);
    d += dv;
  }
  if (d < MIN_BASE) return null;
  return round1((100 * n) / d);
}

/** A published percentage (a rate row) pooled by its base count. */
function pooledRate(das: ProfileValues[], rateId: number, baseId: number): number | null {
  let n = 0;
  let d = 0;
  for (const v of das) {
    const r = rate(v, rateId) ?? count(v, rateId);
    const b = count(v, baseId);
    if (r == null || b == null || b <= 0) continue;
    n += (r * b) / 100;
    d += b;
  }
  if (d < MIN_BASE) return null;
  return round1((100 * n) / d);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Summed counts of `ids` over the DAs that published all of them; null if none did. */
function pooledCounts(das: ProfileValues[], ids: number[]): number[] | null {
  const out = ids.map(() => 0);
  let any = false;
  for (const v of das) {
    const c = ids.map((id) => count(v, id));
    if (c.some((x) => x == null)) continue;
    any = true;
    c.forEach((x, i) => (out[i] += x as number));
  }
  return any ? out : null;
}

/**
 * Median of a grouped distribution by linear interpolation inside the median bin.
 * `bins` are [lo, hi] with hi null for the open top bin (its width is taken equal to the
 * bin below, the usual convention; the median almost never lands there).
 */
export function groupedMedian(counts: number[], bins: ReadonlyArray<{ lo: number; hi: number | null }>): number | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total < MIN_BASE) return null;
  const half = total / 2;
  let cum = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    if (cum + c >= half && c > 0) {
      const { lo, hi } = bins[i];
      const width = hi != null ? hi - lo : i > 0 ? lo - bins[i - 1].lo : lo;
      return lo + ((half - cum) / c) * width;
    }
    cum += c;
  }
  return null;
}

const DURATION_IDS = [C.durUnder15, C.dur15to29, C.dur30to44, C.dur45to59, C.dur60Plus];
const DURATION_BINS = [
  { lo: 0, hi: 15 },
  { lo: 15, hi: 30 },
  { lo: 30, hi: 45 },
  { lo: 45, hi: 60 },
  { lo: 60, hi: 90 },
];

export function areaStats(das: ProfileValues[]): AreaStats {
  const dur = pooledCounts(das, DURATION_IDS);
  const inc = pooledCounts(das, INCOME_GROUPS.map((g) => g.id));
  const commute = dur ? groupedMedian(dur, DURATION_BINS) : null;
  const income = inc ? groupedMedian(inc, INCOME_GROUPS) : null;
  const households = das.reduce<number | null>((a, v) => {
    const h = count(v, C.tenureTotal);
    return h == null ? a : (a ?? 0) + h;
  }, null);
  return {
    households,
    rentPct: pooledShare(das, [C.tenureRenter], C.tenureTotal),
    ownPct: pooledShare(das, [C.tenureOwner], C.tenureTotal),
    moved5Pct: pooledShare(das, [C.mob5Movers], C.mob5Total),
    aptPct: pooledShare(das, [C.typeDuplexApt, C.typeAptUnder5, C.typeApt5Plus], C.typeTotal),
    bed3PlusPct: pooledShare(das, [C.bed3, C.bed4Plus], C.bedTotal),
    builtBefore1981Pct: pooledShare(das, [C.built1960OrBefore, C.built1961to1980], C.builtTotal),
    transitWalkBikePct: pooledShare(das, [C.modeTransit, C.modeWalk, C.modeBike], C.modeTotal),
    drivePct: pooledShare(das, [C.modeCar], C.modeTotal),
    medianCommuteMin: commute == null ? null : Math.round(commute),
    tenantCostBurdenPct: pooledRate(das, C.tenantPct30Plus, C.tenantTotal),
    medianIncome: income == null ? null : Math.round(income / 1000) * 1000,
  };
}

export function buildAreaFacts(pool: ProfileValues[], city: ProfileValues, cityName: string): AreaFacts {
  const inc = pooledCounts(pool, INCOME_GROUPS.map((g) => g.id));
  const pop = pool.reduce<number | null>((a, v) => {
    const p = count(v, C.pop2021);
    return p == null ? a : (a ?? 0) + p;
  }, null);
  return {
    v: 1,
    here: areaStats(pool),
    city: areaStats([city]),
    cityName,
    das: pool.length,
    pop,
    incomeGroups: inc ?? [],
  };
}

export interface RentCheck {
  /** Yearly household income at which this rent is 30% of income. */
  incomeNeeded: number;
  /** Share of households here at or above that income (2020 incomes). */
  sharePct: number;
  /** True when the income needed is in the open top group, so the share is an upper bound. */
  atTop: boolean;
}

/**
 * Can households here pay this rent at 30% of income? Uses the pooled ALL-household income
 * distribution: the DA profile does not split income by tenure, so this is not a renter-only
 * figure, and the card must say "households", never "renters".
 */
export function rentCheck(monthlyRent: number, incomeGroups: number[]): RentCheck | null {
  if (!(monthlyRent > 0) || incomeGroups.length !== INCOME_GROUPS.length) return null;
  const total = incomeGroups.reduce((a, b) => a + b, 0);
  if (total < MIN_BASE) return null;
  const incomeNeeded = Math.round((monthlyRent * 12) / 0.3 / 1000) * 1000;
  let above = 0;
  let atTop = false;
  INCOME_GROUPS.forEach((g, i) => {
    const c = incomeGroups[i];
    if (g.lo >= incomeNeeded) above += c;
    else if (g.hi == null) {
      above += c; // open top bin straddles the threshold: count it whole, flag as an upper bound
      atTop = true;
    } else if (g.hi > incomeNeeded) above += (c * (g.hi - incomeNeeded)) / (g.hi - g.lo);
  });
  return { incomeNeeded, sharePct: Math.round((100 * above) / total), atTop };
}
