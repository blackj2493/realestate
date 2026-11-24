/**
 * A general within-cell log-price regression with a cluster bootstrap — the same method as
 * the basement study (basementValueModel.ts), for any set of features. Used by the school
 * catchment study (scripts/data/buildSchoolPrices.ts).
 *
 * Each row belongs to a cell (similar homes: community × type × bedrooms × size band). Rows
 * and the outcome are demeaned within their cell, so only differences between similar homes
 * inside one cell identify a coefficient. The bootstrap resamples whole cells (seeded), and a
 * term is "significant" when its 95% range excludes zero. Terms with no variation inside any
 * cell are left out and reported as null.
 */
import { solve } from "@/lib/data/basementValueModel";

export interface CellRow {
  cell: string;
  /** Outcome, e.g. log(price). */
  y: number;
  /** Feature values, in the order of `names`. */
  x: number[];
}

export interface Estimate {
  /** Raw coefficient. */
  b: number;
  lo: number;
  hi: number;
  significant: boolean;
}

export interface WithinCellFit {
  n: number;
  cells: number;
  coef: Record<string, Estimate | null>;
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

const pctile = (sorted: number[], q: number) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};

export function fitWithinCell(rows: CellRow[], names: string[], opts: { minCell?: number; boot?: number; seed?: number } = {}): WithinCellFit | null {
  const minCell = opts.minCell ?? 5;
  const boot = opts.boot ?? 300;
  const k = names.length;
  const size = new Map<string, number>();
  for (const r of rows) size.set(r.cell, (size.get(r.cell) ?? 0) + 1);
  const kept = rows.filter((r) => (size.get(r.cell) ?? 0) >= minCell);
  if (kept.length < 200) return null;

  const byCell = new Map<string, CellRow[]>();
  for (const r of kept) {
    const l = byCell.get(r.cell) ?? [];
    l.push(r);
    byCell.set(r.cell, l);
  }
  const XtXs: number[][][] = [];
  const Xtys: number[][] = [];
  for (const list of byCell.values()) {
    const mx = new Array(k).fill(0);
    let my = 0;
    for (const o of list) {
      for (let j = 0; j < k; j++) mx[j] += o.x[j] / list.length;
      my += o.y / list.length;
    }
    const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
    const Xty = new Array(k).fill(0);
    for (const o of list) {
      const xc = o.x.map((v, j) => v - mx[j]);
      const yc = o.y - my;
      for (let a = 0; a < k; a++) {
        if (!xc[a]) continue;
        Xty[a] += xc[a] * yc;
        for (let b = a; b < k; b++) XtX[a][b] += xc[a] * xc[b];
      }
    }
    for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    XtXs.push(XtX);
    Xtys.push(Xty);
  }
  const active: number[] = [];
  for (let j = 0; j < k; j++) if (XtXs.reduce((s, m) => s + m[j][j], 0) > 1e-9) active.push(j);

  const fit = (w: number[] | null): number[] | null => {
    const m = active.length;
    const A = Array.from({ length: m }, () => new Array(m).fill(0));
    const v = new Array(m).fill(0);
    for (let c = 0; c < XtXs.length; c++) {
      const wc = w ? w[c] : 1;
      if (!wc) continue;
      for (let a = 0; a < m; a++) {
        v[a] += wc * Xtys[c][active[a]];
        for (let b = 0; b < m; b++) A[a][b] += wc * XtXs[c][active[a]][active[b]];
      }
    }
    const x = solve(A, v);
    if (!x) return null;
    const full = new Array(k).fill(NaN);
    active.forEach((j, i) => (full[j] = x[i]));
    return full;
  };

  const beta = fit(null);
  if (!beta) return null;
  const rand = rng(opts.seed ?? 1);
  const C = XtXs.length;
  const draws: number[][] = [];
  for (let i = 0; i < boot; i++) {
    const w = new Array(C).fill(0);
    for (let j = 0; j < C; j++) w[Math.floor(rand() * C)]++;
    const b = fit(w);
    if (b) draws.push(b);
  }
  if (draws.length < boot * 0.9) return null;

  const coef: Record<string, Estimate | null> = {};
  names.forEach((name, j) => {
    if (!active.includes(j)) {
      coef[name] = null;
      return;
    }
    const s = draws.map((d) => d[j]).sort((a, b) => a - b);
    const lo = pctile(s, 0.025);
    const hi = pctile(s, 0.975);
    coef[name] = { b: beta[j], lo, hi, significant: lo > 0 || hi < 0 };
  });
  return { n: kept.length, cells: C, coef };
}

/** A log coefficient as a percent gap: 0.06 → +6.2. */
export const asPct = (b: number) => Math.expm1(b) * 100;
