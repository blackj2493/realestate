/**
 * The basement study's statistics: a within-cell log-price regression with a cluster
 * bootstrap. Pure functions only — scripts/data/buildBasementValue.ts feeds them sold rows
 * and writes data/basement-value.json, which /data/basement-value renders.
 *
 * THE MODEL. log(sale price) = cell effect + features + quarter of the sale. A cell is one
 * community × home type × above-grade bedrooms × size band, so every house is compared only
 * with similar houses in its own community. Cells with fewer than MIN_CELL sales drop out.
 * Each feature's coefficient b becomes a price gap exp(b) − 1 against the reference: a
 * similar house whose listing describes neither a finished basement nor an apartment.
 *
 * Two fits per city. Model A leaves the bathroom count out (what a buyer pays for the
 * basement as listed, bathroom included). Model B adds it (the basement with the same
 * number of bathrooms) — the gap between the two is the part a basement bathroom carries.
 *
 * CONFIDENCE. Sales in one community share unobserved traits, so rows are not independent.
 * The bootstrap resamples whole cells (BOOT draws, seeded, so a rerun gives the same
 * interval) and reports the 2.5–97.5 percentile range. A gap is "significant" when that
 * range excludes zero; the page says "not significant" otherwise and never ranks on it.
 */

export const MIN_CELL = 5;
export const BOOT = 300;

/** One sold house, already parsed. */
export interface SaleRow {
  cell: string;
  price: number;
  /** Contract date, YYYY-MM-DD. */
  date: string;
  apt: boolean;
  fin: boolean;
  part: boolean;
  sep: boolean;
  reno: boolean;
  fix: boolean;
  baths: number;
  parking: number;
  lotWidth: number;
}

export interface Effect {
  /** Price gap in percent, e.g. 6.6 = +6.6%. */
  pct: number;
  lo: number;
  hi: number;
  significant: boolean;
}

export interface FitResult {
  n: number;
  cells: number;
  effects: Record<string, Effect>;
  /** Bootstrap range of apt − fin, in percent points of log price ×100. */
  aptMinusFin: { pct: number; lo: number; hi: number; significant: boolean };
}

/** Basement fields as the feed sends them: a JSON array such as ["Finished","Separate Entrance"]. */
export function parseBasement(raw: unknown): Set<string> {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = raw.split(",");
    }
  }
  if (!Array.isArray(arr)) return new Set();
  return new Set(arr.map((s) => String(s).trim()).filter(Boolean));
}

/** The basement flags, with the same precedence as the published study: apartment first. */
export function basementFlags(basement: Set<string>, kitchensBelowGrade: number) {
  const apt = basement.has("Apartment") || kitchensBelowGrade >= 1;
  const fin = !apt && (basement.has("Finished") || basement.has("Finished with Walk-Out"));
  const part = !apt && !fin && basement.has("Partially Finished");
  const sep = basement.has("Separate Entrance");
  return { apt, fin, part, sep };
}

export const RENO_RE = /(fully|completely|totally)\s+(renovated|remodel+ed)/i;
export const FIX_RE =
  /(handy\s?m[ae]n|fixer[\s-]?upper|contractor'?s?\s+(special|dream)|renovator'?s?\s+(special|dream)|needs?\s+(work|updating|renovat\w*|tlc|repairs?)|\btlc\b|tear[\s-]?down)/i;

const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const quarterOf = (d: string) => `${d.slice(0, 4)}Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

/** Deterministic PRNG (mulberry32), so a rerun of the same data gives the same intervals. */
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

/** Solve A x = b for a small symmetric system (Gaussian elimination, partial pivoting). */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-10) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

const pctile = (sorted: number[], q: number) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};
const toPct = (b: number) => Math.expm1(b) * 100;

/**
 * Fit one model. `withBaths` = model B. Returns null when the sample cannot identify the
 * basement terms (no reference houses left, or a singular system).
 */
export function fitBasementModel(rows: SaleRow[], withBaths: boolean, seed = 1): FitResult | null {
  const size = new Map<string, number>();
  for (const r of rows) size.set(r.cell, (size.get(r.cell) ?? 0) + 1);
  const kept = rows.filter((r) => (size.get(r.cell) ?? 0) >= MIN_CELL);
  if (kept.length < 200) return null;

  const quarters = [...new Set(kept.map((r) => quarterOf(r.date)))].sort().slice(1);
  const names = [
    ...(withBaths ? ["baths"] : []),
    "fin", "part", "apt", "sep", "reno", "fix", "parking", "lotWidth",
    ...quarters.map((q) => `q:${q}`),
  ];
  const k = names.length;
  const featuresOf = (r: SaleRow): number[] => {
    const q = quarterOf(r.date);
    return [
      ...(withBaths ? [clip(r.baths, 1, 7)] : []),
      +r.fin, +r.part, +r.apt, +r.sep, +r.reno, +r.fix,
      clip(r.parking, 0, 8),
      Math.log(clip(r.lotWidth, 15, 150)),
      ...quarters.map((x) => +(x === q)),
    ];
  };

  // Demean within cell, then keep each cell's X'X and X'y so the bootstrap is a weighted sum.
  const byCell = new Map<string, { x: number[]; y: number }[]>();
  for (const r of kept) {
    const list = byCell.get(r.cell) ?? [];
    list.push({ x: featuresOf(r), y: Math.log(r.price) });
    byCell.set(r.cell, list);
  }
  const cellXtX: number[][][] = [];
  const cellXty: number[][] = [];
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
    cellXtX.push(XtX);
    cellXty.push(Xty);
  }

  // A term with no variation inside cells (e.g. no fixer-upper sold in this city) cannot be
  // estimated and would make the system singular: leave it out and report it as 0.
  const active: number[] = [];
  for (let j = 0; j < k; j++) if (cellXtX.reduce((s, m) => s + m[j][j], 0) > 1e-9) active.push(j);

  const fitWith = (weights: number[] | null): number[] | null => {
    const m = active.length;
    const A = Array.from({ length: m }, () => new Array(m).fill(0));
    const v = new Array(m).fill(0);
    for (let c = 0; c < cellXtX.length; c++) {
      const w = weights ? weights[c] : 1;
      if (!w) continue;
      for (let a = 0; a < m; a++) {
        v[a] += w * cellXty[c][active[a]];
        for (let b = 0; b < m; b++) A[a][b] += w * cellXtX[c][active[a]][active[b]];
      }
    }
    const x = solve(A, v);
    if (!x) return null;
    const full = new Array(k).fill(0);
    active.forEach((j, i) => (full[j] = x[i]));
    return full;
  };
  // The basement terms themselves must be estimable.
  for (const name of ["fin", "apt"]) if (!active.includes(names.indexOf(name))) return null;

  const beta = fitWith(null);
  if (!beta) return null;

  const rand = rng(seed);
  const draws: number[][] = [];
  const C = cellXtX.length;
  for (let i = 0; i < BOOT; i++) {
    const w = new Array(C).fill(0);
    for (let j = 0; j < C; j++) w[Math.floor(rand() * C)]++;
    const b = fitWith(w);
    if (b) draws.push(b);
  }
  if (draws.length < BOOT * 0.9) return null;

  const effects: Record<string, Effect> = {};
  const report = withBaths ? ["baths", "fin", "apt", "sep", "reno", "fix"] : ["fin", "apt", "sep", "reno", "fix"];
  for (const name of report) {
    const j = names.indexOf(name);
    const s = draws.map((d) => d[j]).sort((a, b) => a - b);
    const lo = pctile(s, 0.025);
    const hi = pctile(s, 0.975);
    effects[name] = { pct: toPct(beta[j]), lo: toPct(lo), hi: toPct(hi), significant: lo > 0 || hi < 0 };
  }
  const ja = names.indexOf("apt");
  const jf = names.indexOf("fin");
  const diff = draws.map((d) => d[ja] - d[jf]).sort((a, b) => a - b);
  const dlo = pctile(diff, 0.025) * 100;
  const dhi = pctile(diff, 0.975) * 100;
  return {
    n: kept.length,
    cells: C,
    effects,
    aptMinusFin: { pct: (beta[ja] - beta[jf]) * 100, lo: dlo, hi: dhi, significant: dlo > 0 || dhi < 0 },
  };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
