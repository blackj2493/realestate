/**
 * AVM backtest result ANALYZER (read-only, local JSON; no DB, no network).
 *
 * Slices a backtest result file (avm-backtest.ts --out) every way that matters for
 * diagnosing WHERE the error lives and WHETHER the confidence bands are honest:
 *   - overall + by price tier, property type, basis, confidence
 *   - by feature presence (sqft present?, lot present?) — tests the missing-data hypothesis
 *   - calibration: band coverage overall and per confidence label (HIGH bands should
 *     contain the truth ~68% of the time; if they don't, the model is overconfident)
 *   - signed bias by tier/type (is the model systematically LOW for big/expensive homes?)
 *
 * Usage: npx.cmd tsx scripts/admin/avm-bt-analyze.ts avm-bt-baseline.json
 */
import * as fs from 'fs';

interface Row {
  close_price: number;
  estimated_value: number | null;
  log_error: number | null;       // ln(est) - ln(close); >0 = estimate HIGH, <0 = estimate LOW
  abs_pct_error: number | null;
  basis: string;
  confidence: string;
  n_eff: number | null;
  comps: number | null;
  in_band: boolean | null;
  price_tier: string;
  property_sub_type: string | null;
  norm_sub: string;
  sqft_present: boolean;
  lot_present: boolean;
  untrained: boolean;
  borrowed: boolean;
}

const path = process.argv[2] || 'avm-bt-baseline.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const rows: Row[] = (Array.isArray(raw) ? raw : raw.results) as Row[];

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x: number) => (Number.isNaN(x) ? 'n/a' : (x * 100).toFixed(2) + '%');

/** Print a metrics line for a subset that has published estimates. */
function line(label: string, sub: Row[]) {
  const pub = sub.filter((r) => r.abs_pct_error !== null);
  if (pub.length === 0) {
    console.log(`   ${label.padEnd(26)} n=${sub.length} (0 published)`);
    return;
  }
  const abs = pub.map((r) => r.abs_pct_error as number);
  const logs = pub.map((r) => r.log_error as number);
  const hit10 = pub.filter((r) => (r.abs_pct_error as number) <= 0.1).length / pub.length;
  const band = pub.filter((r) => r.in_band === true).length / pub.length;
  console.log(
    `   ${label.padEnd(26)} n=${String(sub.length).padStart(5)} pub=${String(pub.length).padStart(5)}` +
      ` | med ${pct(median(abs)).padStart(7)} | mean ${pct(mean(abs)).padStart(7)}` +
      ` | bias ${(mean(logs) >= 0 ? '+' : '') + (mean(logs) * 100).toFixed(2) + '%'}`.padEnd(16) +
      ` | ±10% ${pct(hit10).padStart(7)} | band ${pct(band).padStart(7)}`,
  );
}

function group(label: string, keyOf: (r: Row) => string, order?: string[]) {
  console.log(`\n──────── BY ${label} ────────`);
  const keys = new Map<string, Row[]>();
  for (const r of rows) {
    const k = keyOf(r);
    (keys.get(k) ?? keys.set(k, []).get(k)!).push(r);
  }
  const ordered = order ? order.filter((k) => keys.has(k)) : [...keys.keys()].sort((a, b) => (keys.get(b)!.length - keys.get(a)!.length));
  for (const k of ordered) line(k, keys.get(k)!);
}

console.log(`\n=== AVM backtest analysis: ${path}  (${rows.length} rows) ===`);
console.log('   legend: bias = mean(ln est − ln close); NEGATIVE bias = estimate runs LOW.');

line('OVERALL', rows);

group('PRICE TIER', (r) => r.price_tier, ['<500k', '500k-1M', '1M-1.5M', '1.5M-2M', '2M+']);
group('PROPERTY TYPE (norm)', (r) => r.norm_sub || '(blank)');
group('BASIS', (r) => r.basis);
group('CONFIDENCE', (r) => r.confidence, ['HIGH', 'MEDIUM', 'LOW']);
group('SQFT PRESENT', (r) => (r.sqft_present ? 'sqft present' : 'sqft MISSING'));
group('LOT PRESENT', (r) => (r.lot_present ? 'lot present' : 'lot MISSING'));
group('TRAINED?', (r) => (r.untrained ? 'untrained cohort' : 'trained cohort'));

// ── Tier × basis cross-tab: where do expensive homes route, and how biased? ──
console.log('\n──────── 2M+ and 1.5M-2M by BASIS (is the tail stuck on clamped local?) ────────');
for (const t of ['1.5M-2M', '2M+']) {
  const sub = rows.filter((r) => r.price_tier === t);
  const byBasis = new Map<string, Row[]>();
  for (const r of sub) (byBasis.get(r.basis) ?? byBasis.set(r.basis, []).get(r.basis)!).push(r);
  console.log(`  ${t}:`);
  for (const [b, g] of [...byBasis.entries()].sort((a, b2) => b2[1].length - a[1].length)) {
    const pubg = g.filter((r) => r.abs_pct_error !== null);
    if (!pubg.length) { console.log(`     ${b.padEnd(10)} n=${g.length} (suppressed)`); continue; }
    const bias = mean(pubg.map((r) => r.log_error as number));
    console.log(`     ${b.padEnd(10)} n=${String(g.length).padStart(4)}  med ${pct(median(pubg.map((r) => r.abs_pct_error as number))).padStart(7)}  bias ${((bias >= 0 ? '+' : '') + (bias * 100).toFixed(1) + '%').padStart(7)}`);
  }
}

// ── Calibration deep-dive: a 1-SD band should cover ~68% if honest. ──
console.log('\n──────── CALIBRATION (band coverage vs ideal 68.2% for 1-SD) ────────');
const pub = rows.filter((r) => r.abs_pct_error !== null);
const cov = pub.filter((r) => r.in_band === true).length / pub.length;
console.log(`   overall band coverage: ${pct(cov)}  (ideal ≈ 68.2%)  → ${cov < 0.5 ? 'SEVERELY OVERCONFIDENT' : cov < 0.65 ? 'overconfident' : 'ok'}`);
for (const c of ['HIGH', 'MEDIUM', 'LOW']) {
  const sub = pub.filter((r) => r.confidence === c);
  if (!sub.length) continue;
  const cc = sub.filter((r) => r.in_band === true).length / sub.length;
  const med = median(sub.map((r) => r.abs_pct_error as number));
  console.log(`   ${c.padEnd(7)} coverage ${pct(cc).padStart(7)}  median|%err| ${pct(med).padStart(7)}  n=${sub.length}`);
}

// ── Tail analysis: how bad are the worst estimates, and what do they look like? ──
console.log('\n──────── TAIL (worst 5% by |%err|) ────────');
const sortedByErr = [...pub].sort((a, b) => (b.abs_pct_error as number) - (a.abs_pct_error as number));
const tailN = Math.ceil(pub.length * 0.05);
const tail = sortedByErr.slice(0, tailN);
const tailLow = tail.filter((r) => (r.log_error as number) < 0).length; // estimate too LOW
console.log(`   worst ${tailN} estimates: median |%err| ${pct(median(tail.map((r) => r.abs_pct_error as number)))}`);
console.log(`   of those, estimate ran LOW (under-valued): ${tailLow}/${tailN} (${pct(tailLow / tailN)})`);
const tailTier: Record<string, number> = {};
const tailType: Record<string, number> = {};
for (const r of tail) {
  tailTier[r.price_tier] = (tailTier[r.price_tier] ?? 0) + 1;
  tailType[r.norm_sub || '(blank)'] = (tailType[r.norm_sub || '(blank)'] ?? 0) + 1;
}
console.log('   tail by tier:', Object.entries(tailTier).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('   tail by type:', Object.entries(tailType).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join('  '));

// ── Suppression: how many were withheld, and would they have been any good? ──
const suppressed = rows.filter((r) => r.abs_pct_error === null);
console.log(`\n──────── SUPPRESSION ────────`);
console.log(`   suppressed (no number shown): ${suppressed.length}/${rows.length} (${pct(suppressed.length / rows.length)})`);

console.log('\nDONE.');
