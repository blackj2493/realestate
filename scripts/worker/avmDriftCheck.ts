/**
 * AVM accuracy drift gate — reads an avm-backtest.ts result file and decides whether the
 * LIVE AVM's out-of-time accuracy has degraded past an acceptable threshold.
 *
 * The backtest replays the deployed model against held-out sold sales and writes per-sale
 * rows ({ abs_pct_error, price_tier, in_band, ... }) to a JSON file. This computes the
 * headline accuracy (median / mean |%err|, ±10/±20% hit-rate, band coverage) and exits
 * NON-ZERO when the median |%err| crosses the threshold — which turns the monitor workflow
 * red and fires the failure alert ("coefficients drifting — retrain due"). Within threshold
 * it exits 0 and prints the accuracy so the notifier emails it every run.
 *
 * Deterministic, no AI. Reads a local file only — no DB, no writes.
 *
 * Env:  AVM_MAX_MEDIAN_PCT  max acceptable median |%err| as a fraction (default 0.13 = 13%)
 * Usage: npx tsx scripts/worker/avmDriftCheck.ts [path-to-backtest.json]
 */
import * as fs from 'fs';

const IN_PATH = process.argv[2] || 'avm-backtest.json';
const MAX_MEDIAN = Number(process.env.AVM_MAX_MEDIAN_PCT) || 0.13;

interface ResultRow {
  abs_pct_error: number | null;
  in_band: boolean | null;
  price_tier: string;
}
interface Backtest {
  run_id?: string;
  n?: number;
  params?: Record<string, unknown>;
  results: ResultRow[];
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x: number) => (Number.isNaN(x) ? 'n/a' : (x * 100).toFixed(2) + '%');

function main(): void {
  if (!fs.existsSync(IN_PATH)) {
    console.error(`❌ Backtest result file not found: ${IN_PATH} (did avm-backtest.ts run?)`);
    process.exit(1);
  }
  let data: Backtest;
  try {
    data = JSON.parse(fs.readFileSync(IN_PATH, 'utf8')) as Backtest;
  } catch (e) {
    console.error(`❌ Could not parse ${IN_PATH}: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  const rows = Array.isArray(data.results) ? data.results : [];
  const est = rows.filter((r) => typeof r.abs_pct_error === 'number');
  if (est.length === 0) {
    console.error('❌ Backtest produced no published estimates — cannot assess accuracy.');
    process.exit(1);
  }

  const abs = est.map((r) => r.abs_pct_error as number);
  const med = median(abs);
  const avg = mean(abs);
  const hit10 = est.filter((r) => (r.abs_pct_error as number) <= 0.1).length / est.length;
  const hit20 = est.filter((r) => (r.abs_pct_error as number) <= 0.2).length / est.length;
  const banded = est.filter((r) => r.in_band === true).length;
  const bandCov = banded / est.length;

  const degraded = med > MAX_MEDIAN;
  const verdict = degraded ? '🔴 DRIFT — retrain due' : '🟢 within tolerance';

  // Concise summary — the notifier quotes this into the email.
  console.log(`AVM accuracy backtest (${data.run_id ?? 'n/a'}) — ${est.length.toLocaleString()} held-out sales`);
  console.log(`  Median |%err|:  ${pct(med)}   (threshold ${pct(MAX_MEDIAN)})`);
  console.log(`  Mean   |%err|:  ${pct(avg)}`);
  console.log(`  Hit ±10% / ±20%: ${pct(hit10)} / ${pct(hit20)}`);
  console.log(`  Band coverage:   ${pct(bandCov)}`);
  console.log(`  Verdict: ${verdict}`);

  if (degraded) {
    console.error(
      `\n🔴 AVM median |%err| ${pct(med)} exceeds the ${pct(MAX_MEDIAN)} threshold — the trained coefficients have drifted from the market. Retrain the AVM matrices (offline) or, once live, let the champion/challenger job promote a fresher set.`,
    );
    process.exit(1);
  }
  console.log(`\n✅ AVM accuracy healthy (median ${pct(med)} ≤ ${pct(MAX_MEDIAN)}).`);
}

main();
