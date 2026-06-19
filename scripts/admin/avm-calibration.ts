/**
 * AVM CALIBRATION analyzer (read-only, local JSON).
 *
 * The live predSD covers only sampling + between-community variance, never model
 * MISSPECIFICATION — so a "1-SD" band covers ~18% of truths instead of ~68%. This
 * computes, from real backtest residuals (log_error) and the model's own predSD:
 *   1. the empirical residual log-SD overall and per segment (the HONEST band width);
 *   2. the misspecification floor σ_floor s.t. effSD = sqrt(predSD² + σ_floor²) makes
 *      a 1-SD band cover ~68% (added in quadrature, the leakage-safe global recalibration);
 *   3. what coverage that floor delivers per confidence label, and sensible new
 *      confidence thresholds on effSD (so HIGH is genuinely tight, not inverted).
 *
 * Usage: npx.cmd tsx scripts/admin/avm-calibration.ts avm-exp-baseline.json
 */
import * as fs from 'fs';

interface Row { log_error: number | null; abs_pct_error: number | null; predictive_sd: number | null; confidence: string; price_tier: string; norm_sub: string; in_band: boolean | null; }
const path = process.argv[2] || 'avm-exp-baseline.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const rows: Row[] = (Array.isArray(raw) ? raw : raw.results) as Row[];
const pub = rows.filter((r) => r.log_error !== null && r.predictive_sd !== null && Number.isFinite(r.predictive_sd as number));

function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i];
}
const pctS = (x: number) => (Number.isNaN(x) ? 'n/a' : (x * 100).toFixed(2) + '%');

// Coverage of a 1-SD band given an effective-SD function (log space, symmetric).
function coverage(effSD: (r: Row) => number): number {
  let inb = 0;
  for (const r of pub) {
    const e = effSD(r);
    if (Math.abs(r.log_error as number) <= e) inb++;
  }
  return inb / pub.length;
}

const logErrs = pub.map((r) => r.log_error as number);
const absLog = logErrs.map(Math.abs);
console.log(`\n=== CALIBRATION: ${path}  (${pub.length} published rows) ===`);
console.log(`residual log-error: SD ${pctS(sd(logErrs))}  ·  |log-err| p50 ${pctS(quantile(absLog, 0.5))}  p68 ${pctS(quantile(absLog, 0.68))}  p90 ${pctS(quantile(absLog, 0.9))}`);
console.log(`current predSD:     mean ${pctS(pub.reduce((a, r) => a + (r.predictive_sd as number), 0) / pub.length)}  ·  current 1-SD coverage ${pctS(coverage((r) => r.predictive_sd as number))}`);

// The honest 1-SD half-width = the 68th percentile of |log error| (by definition of coverage).
console.log(`\nHONEST 1-SD band half-width = p68(|log err|) = ${pctS(quantile(absLog, 0.68))}  (a band of ±this covers 68% by construction)`);

// Solve for the misspecification floor σ s.t. sqrt(predSD² + σ²) gives 68% coverage.
function coverageWithFloor(sigma: number): number {
  return coverage((r) => Math.sqrt((r.predictive_sd as number) ** 2 + sigma ** 2));
}
let lo = 0, hi = 0.6;
for (let i = 0; i < 40; i++) {
  const mid = (lo + hi) / 2;
  if (coverageWithFloor(mid) < 0.682) lo = mid; else hi = mid;
}
const floor = (lo + hi) / 2;
console.log(`\nMISSPECIFICATION FLOOR (added in quadrature): σ_floor = ${floor.toFixed(4)}  (${pctS(floor)})  → coverage ${pctS(coverageWithFloor(floor))}`);
const effSDs = pub.map((r) => Math.sqrt((r.predictive_sd as number) ** 2 + floor ** 2));
console.log(`with floor: effSD mean ${pctS(effSDs.reduce((a, b) => a + b, 0) / effSDs.length)}  min ${pctS(Math.min(...effSDs))}  p50 ${pctS(quantile(effSDs, 0.5))}  max ${pctS(quantile(effSDs, 0.99))}`);

// Per-confidence + per-tier honest band half-widths (p68 of |log err|).
function segReport(label: string, keyOf: (r: Row) => string, order?: string[]) {
  console.log(`\n── honest band (p68 |log err|) + floor-coverage by ${label} ──`);
  const groups = new Map<string, Row[]>();
  for (const r of pub) { const k = keyOf(r); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  const keys = order ? order.filter((k) => groups.has(k)) : [...groups.keys()];
  for (const k of keys) {
    const g = groups.get(k)!;
    const al = g.map((r) => Math.abs(r.log_error as number));
    const covFloor = g.filter((r) => Math.abs(r.log_error as number) <= Math.sqrt((r.predictive_sd as number) ** 2 + floor ** 2)).length / g.length;
    console.log(`   ${k.padEnd(12)} n=${String(g.length).padStart(5)}  honest±(p68) ${pctS(quantile(al, 0.68)).padStart(7)}  resid-SD ${pctS(sd(g.map((r) => r.log_error as number))).padStart(7)}  cov@floor ${pctS(covFloor).padStart(7)}`);
  }
}
segReport('CONFIDENCE', (r) => r.confidence, ['HIGH', 'MEDIUM', 'LOW']);
segReport('PRICE TIER', (r) => r.price_tier, ['<500k', '500k-1M', '1M-1.5M', '1.5M-2M', '2M+']);

// Proposed confidence thresholds on effSD: pick so the buckets are honest & monotone.
// HIGH = effSD below the 33rd pct, MEDIUM below 66th, else LOW; print the cut points + their true error.
const sorted = [...effSDs].sort((a, b) => a - b);
const t33 = sorted[Math.floor(sorted.length * 0.33)];
const t66 = sorted[Math.floor(sorted.length * 0.66)];
console.log(`\nPROPOSED confidence thresholds on effSD (tertiles): HIGH < ${t33.toFixed(3)}  ·  MEDIUM < ${t66.toFixed(3)}  ·  else LOW`);
for (const [lab, pred] of [['HIGH', (e: number) => e < t33], ['MEDIUM', (e: number) => e >= t33 && e < t66], ['LOW', (e: number) => e >= t66]] as const) {
  const idx = effSDs.map((e, i) => (pred(e) ? i : -1)).filter((i) => i >= 0);
  const al = idx.map((i) => Math.abs(pub[i].log_error as number));
  const cov = idx.filter((i) => Math.abs(pub[i].log_error as number) <= effSDs[i]).length / idx.length;
  console.log(`   ${lab.padEnd(7)} n=${String(idx.length).padStart(5)}  median|%err| ${pctS(quantile(al, 0.5)).padStart(7)}  coverage ${pctS(cov).padStart(7)}`);
}
console.log('\nDONE.');
