/**
 * Same-home price change: pure statistics for scripts/data/buildPriceChange.ts, which writes
 * data/price-change.json for /data/price-change.
 *
 * THE METHOD. A city's median sale price moves when the MIX of homes sold moves (more condos,
 * fewer detached), not only when prices move. So we compare like with like: a cell is one
 * community × home type × above-grade bedrooms × size band, and each cell's median price in
 * the later period is set against its own median in the earlier period. A group's change is
 * the weighted mean of the cells' log changes (weight = the smaller of the two sale counts),
 * turned back into a percent. Cells need MIN_SIDE sales in each period.
 *
 * CONFIDENCE. The 95% range resamples whole cells (BOOT draws, seeded). "Significant" means
 * the range excludes zero; the pages say "no clear change" otherwise.
 */

export const BOOT = 500;

export interface PricedSale {
  cell: string;
  price: number;
  /** 0 = earlier period, 1 = later period. */
  side: 0 | 1;
}

export interface Change {
  /** Percent, e.g. −6.0. */
  pct: number;
  lo: number;
  hi: number;
  significant: boolean;
  /** Cells with enough sales on both sides. */
  cells: number;
  /** Later-period sales inside those cells. */
  sales: number;
  /** Weighted share of cells whose median fell (0–1). */
  shareDown: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function medianOf(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pctile = (sorted: number[], q: number) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};

/**
 * The same-home change between the two sides, or null when fewer than minCells cells
 * qualify (too little to say anything).
 */
export function sameHomeChange(sales: PricedSale[], minSide = 3, minCells = 20, seed = 1): Change | null {
  const by = new Map<string, [number[], number[]]>();
  for (const s of sales) {
    const e = by.get(s.cell) ?? [[], []];
    e[s.side].push(s.price);
    by.set(s.cell, e);
  }
  const cells: { ch: number; w: number; n1: number }[] = [];
  for (const [a, b] of by.values()) {
    if (a.length < minSide || b.length < minSide) continue;
    cells.push({ ch: Math.log(medianOf(b) / medianOf(a)), w: Math.min(a.length, b.length), n1: b.length });
  }
  if (cells.length < minCells) return null;

  const mean = (idx: number[]) => {
    let sw = 0;
    let s = 0;
    for (const i of idx) {
      sw += cells[i].w;
      s += cells[i].w * cells[i].ch;
    }
    return s / sw;
  };
  const all = cells.map((_, i) => i);
  const est = mean(all);
  const rand = rng(seed);
  const draws: number[] = [];
  for (let b = 0; b < BOOT; b++) {
    const idx = all.map(() => Math.floor(rand() * cells.length));
    draws.push(mean(idx));
  }
  draws.sort((x, y) => x - y);
  const lo = Math.expm1(pctile(draws, 0.025)) * 100;
  const hi = Math.expm1(pctile(draws, 0.975)) * 100;
  const sw = cells.reduce((s, c) => s + c.w, 0);
  return {
    pct: Math.expm1(est) * 100,
    lo,
    hi,
    significant: lo > 0 || hi < 0,
    cells: cells.length,
    sales: cells.reduce((s, c) => s + c.n1, 0),
    shareDown: cells.reduce((s, c) => s + (c.ch < 0 ? c.w : 0), 0) / sw,
  };
}

/** The four home-type groups the pages report. */
export const TYPE_GROUPS = ["detached", "semiTown", "condoApt", "condoTown"] as const;
export type TypeGroup = (typeof TYPE_GROUPS)[number];

export function typeGroupOf(subType: string): TypeGroup | null {
  switch (subType.trim()) {
    case "Detached":
      return "detached";
    case "Semi-Detached":
    case "Att/Row/Townhouse":
    case "Link":
      return "semiTown";
    case "Condo Apartment":
      return "condoApt";
    case "Condo Townhouse":
      return "condoTown";
    default:
      return null;
  }
}

export const TYPE_LABEL: Record<TypeGroup, string> = {
  detached: "Detached houses",
  semiTown: "Semi-detached and townhouses",
  condoApt: "Condo apartments",
  condoTown: "Condo townhouses",
};
