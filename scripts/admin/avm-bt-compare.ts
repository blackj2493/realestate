/**
 * Side-by-side comparison of two backtest result JSONs (A=baseline, B=variant).
 * Reports overall + by price tier + by property type: median/mean |%err|, bias,
 * ±10% hit, band coverage, n. Only compares rows present in BOTH (same eval set).
 *
 * Usage: npx.cmd tsx scripts/admin/avm-bt-compare.ts avm-exp-final-prod.json avm-exp-geo.json
 */
import * as fs from 'fs';

interface Row { listing_key: string; close_price: number; abs_pct_error: number | null; log_error: number | null; in_band: boolean | null; price_tier: string; norm_sub: string; }
function load(p: string): Map<string, Row> {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rows: Row[] = (Array.isArray(raw) ? raw : raw.results) as Row[];
  return new Map(rows.map((r) => [r.listing_key, r]));
}
const A = load(process.argv[2]); const B = load(process.argv[3]);
const keys = [...A.keys()].filter((k) => B.has(k));

function median(xs: number[]): number { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const P = (x: number) => (Number.isNaN(x) ? '  n/a' : (x * 100).toFixed(1) + '%');
const D = (a: number, b: number) => { const d = (b - a) * 100; return (d >= 0 ? '+' : '') + d.toFixed(1) + 'pp'; };

function stats(rows: Row[]) {
  const pub = rows.filter((r) => r.abs_pct_error !== null);
  if (!pub.length) return null;
  return {
    n: rows.length, pub: pub.length,
    med: median(pub.map((r) => r.abs_pct_error as number)),
    mn: mean(pub.map((r) => r.abs_pct_error as number)),
    bias: mean(pub.map((r) => r.log_error as number)),
    hit10: pub.filter((r) => (r.abs_pct_error as number) <= 0.1).length / pub.length,
    band: pub.filter((r) => r.in_band === true).length / pub.length,
  };
}

function line(label: string, sel: (r: Row) => boolean) {
  const aRows = keys.map((k) => A.get(k)!).filter(sel);
  const bRows = keys.map((k) => B.get(k)!).filter(sel);
  const a = stats(aRows), b = stats(bRows);
  if (!a || !b) { console.log(`${label.padEnd(20)} (insufficient)`); return; }
  console.log(
    `${label.padEnd(20)} n=${String(a.n).padStart(5)} | med ${P(a.med)}→${P(b.med)} (${D(a.med, b.med)}) | mean ${P(a.mn)}→${P(b.mn)} (${D(a.mn, b.mn)}) | bias ${P(a.bias)}→${P(b.bias)} | ±10 ${P(a.hit10)}→${P(b.hit10)} | band ${P(a.band)}→${P(b.band)} | pub ${a.pub}→${b.pub}`,
  );
}

console.log(`\n=== COMPARE  A=${process.argv[2]}  →  B=${process.argv[3]}   (${keys.length} shared rows) ===`);
console.log('  (med/mean |%err| lower=better; bias→0 better; ±10/band higher=better)\n');
line('OVERALL', () => true);
console.log('\n-- by price tier --');
for (const t of ['<500k', '500k-1M', '1M-1.5M', '1.5M-2M', '2M+']) line(t, (r) => r.price_tier === t);
console.log('\n-- by property type --');
for (const t of ['Detached', 'Condo Apartment', 'Townhouse', 'Semi-Detached']) line(t, (r) => r.norm_sub === t);
console.log('');
