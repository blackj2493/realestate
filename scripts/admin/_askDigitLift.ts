/**
 * (c) Ask-digit lift backtest — which list-price digit patterns predict an over-ask close?
 *
 * Why this exists: production's "priced to compete" detector (detectCompetitive in
 * src/lib/avm/salePrice.ts) gates on isThresholdPrice(), which recognises ONE pattern —
 * the top $5k of a $100k band ($_95,000–$_99,999, the GTA "list at 999, hold offers" play).
 * A listing asking $688,000 (remainder $88,000) fails that gate outright, so the detector
 * never reaches its comp test even when the ask sits far below comps. This script asks the
 * data which remainders actually carry over-ask lift, instead of assuming.
 *
 * Method mirrors _thresholdPriceLift.ts exactly so the numbers are comparable:
 *   - raw_vow_sold, purchase_contract_date within the window, close_price >= --min-sale
 *   - close/list clamped to [R_MIN, R_MAX] to drop mistyped-list artifacts
 *   - outcomes: over-ask rate P(close>list), median close/list, bid-up rate P(c/l >= 1.03)
 *
 * Two views:
 *   1. UNCONDITIONAL — every $1k remainder band (0..99) within a $100k band, ranked.
 *      Purely descriptive: no family is assumed, the bands speak for themselves.
 *   2. BELOW-COMPS — the same bands restricted to homes an AVM backtest run says were
 *      listed >= --margin under their comp value. This is the population detectCompetitive
 *      actually fires on, so THESE are the rates the UI may quote.
 *
 * Leakage note (inherited): raw_vow_sold.list_price is the LAST list, not the original.
 * Homes bid up rarely had reductions, so last==original for most of the fired bucket, but
 * coverage among price-cut homes is understated. Stated in the report, not corrected.
 *
 * READ-ONLY (§12). No writes. Deterministic (§4). Native fetch; *.supabase.co has a valid
 * cert so no TLS bypass.
 *
 *   npx.cmd tsx --env-file=.env scripts/admin/_askDigitLift.ts --months 24
 *   npx.cmd tsx --env-file=.env scripts/admin/_askDigitLift.ts --avm-run baseline-2026-06-02
 */

import { createClient } from '@supabase/supabase-js';

function numFlag(name: string, def: number): number {
  const a = process.argv.find((x) => x.startsWith(name));
  if (!a) return def;
  const raw = a.includes('=') ? a.split('=')[1] : process.argv[process.argv.indexOf(a) + 1];
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}
function strFlag(name: string, def: string): string {
  const a = process.argv.find((x) => x.startsWith(name));
  if (!a) return def;
  return a.includes('=') ? a.split('=')[1] : (process.argv[process.argv.indexOf(a) + 1] ?? def);
}

const MONTHS = numFlag('--months', 24);
const MIN_SALE = numFlag('--min-sale', 100000); // drop leases / junk (memory avm-trend-lease-contamination)
const MARGIN = numFlag('--margin', 0.05); // COMPETITIVE_COMP_MARGIN
const MIN_N = numFlag('--min-n', 40); // don't report a band thinner than this
const AVM_RUN = strFlag('--avm-run', 'baseline-2026-06-02');
const R_MIN = 0.3;
const R_MAX = 3.0;
const READ_PAGE = 1000;
const MAX_RETRIES = 5;

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** The $1k remainder band of a list price within its $100k band: $688,000 -> 88. */
const bandOf = (p: number) => Math.floor(mod(p, 100_000) / 1000);

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

interface Rec {
  key: string;
  list: number;
  close: number;
  r: number;
  over: boolean;
  bidup: boolean;
  band: number;
}

interface Row {
  listing_key: string;
  close_price: number | null;
  list_price: number | null;
  purchase_contract_date: string | null;
}

async function readPage(cursor: string, sinceIso: string): Promise<Row[] | null> {
  let attempt = 0;
  for (;;) {
    const { data, error } = await sb
      .from('raw_vow_sold')
      .select('listing_key, close_price, list_price, purchase_contract_date')
      .gt('listing_key', cursor)
      .gte('purchase_contract_date', sinceIso)
      .gte('close_price', MIN_SALE)
      .order('listing_key', { ascending: true })
      .limit(READ_PAGE);
    if (!error) return data as unknown as Row[] | null;
    attempt++;
    if (attempt > MAX_RETRIES) throw new Error(`read failed at "${cursor}": ${error.message}`);
    await sleep(Math.min(30000, 2000 * 2 ** (attempt - 1)));
  }
}

async function loadAvmRun(runId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let cursor = '';
  type AvmRow = { listing_key: string; estimated_value: number | null };
  for (;;) {
    let attempt = 0;
    let rows: AvmRow[] = [];
    for (;;) {
      const res = await sb
        .from('avm_backtest_results')
        .select('listing_key, estimated_value')
        .eq('backtest_run_id', runId)
        .eq('leaky', false)
        .gt('listing_key', cursor)
        .order('listing_key', { ascending: true })
        .limit(READ_PAGE);
      if (!res.error) {
        rows = (res.data ?? []) as unknown as AvmRow[];
        break;
      }
      attempt++;
      if (attempt > MAX_RETRIES) throw new Error(res.error.message);
      await sleep(Math.min(30000, 2000 * 2 ** (attempt - 1)));
    }
    if (!rows.length) break;
    for (const r of rows) {
      cursor = r.listing_key;
      if (r.estimated_value && r.estimated_value > 0) out.set(r.listing_key, r.estimated_value);
    }
    if (rows.length < READ_PAGE) break;
  }
  return out;
}

function stats(recs: Rec[]) {
  const n = recs.length;
  const over = recs.filter((x) => x.over).length;
  const bidup = recs.filter((x) => x.bidup).length;
  return {
    n,
    overRate: n ? over / n : NaN,
    bidupRate: n ? bidup / n : NaN,
    medRatio: median(recs.map((x) => x.r)),
  };
}

function bandTable(recs: Rec[], label: string, baseOverRate: number) {
  const by = new Map<number, Rec[]>();
  for (const r of recs) {
    const a = by.get(r.band);
    if (a) a.push(r);
    else by.set(r.band, [r]);
  }
  const rows = [...by.entries()]
    .map(([band, rs]) => ({ band, ...stats(rs) }))
    .filter((x) => x.n >= MIN_N)
    .sort((a, b) => b.overRate - a.overRate);

  console.log(`\n${label}`);
  console.log(`  base over-ask rate across all bands: ${(baseOverRate * 100).toFixed(1)}%`);
  console.log('  band     n    over-ask   lift    bid-up≥3%   med c/l   example ask');
  for (const x of rows.slice(0, 18)) {
    const ex = `$_${String(x.band).padStart(2, '0')},000`;
    const lift = (x.overRate - baseOverRate) * 100;
    console.log(
      `  ${String(x.band).padStart(4)} ${String(x.n).padStart(6)}   ${(x.overRate * 100).toFixed(1).padStart(5)}%  ${(lift >= 0 ? '+' : '') + lift.toFixed(1).padStart(5)}pp   ${(x.bidupRate * 100).toFixed(1).padStart(5)}%    ${x.medRatio.toFixed(3)}   ${ex}`,
    );
  }
  console.log(`  … ${rows.length} bands with n >= ${MIN_N}; showing top 18 by over-ask rate`);
  return rows;
}

async function main() {
  console.log('========================================');
  console.log('  (c) Ask-digit lift backtest');
  console.log(`  window: last ${MONTHS} mo  ·  close>=$${MIN_SALE.toLocaleString()}  ·  c/l band ${R_MIN}-${R_MAX}`);
  console.log(`  below-comps margin: AVM >= list x ${(1 + MARGIN).toFixed(2)}  ·  run "${AVM_RUN}"`);
  console.log('========================================\n');

  const sinceIso = monthsAgoIso(MONTHS);
  console.log(`📥 Streaming raw_vow_sold (purchase_contract_date >= ${sinceIso})…`);
  const recs: Rec[] = [];
  let cursor = '';
  let dropped = 0;
  for (;;) {
    let page: Row[] | null;
    try {
      page = await readPage(cursor, sinceIso);
    } catch (e) {
      console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
    if (!page || !page.length) break;
    for (const r of page) {
      cursor = r.listing_key;
      const close = Number(r.close_price) || 0;
      const list = Number(r.list_price) || 0;
      if (!(close > 0) || !(list > 0)) {
        dropped++;
        continue;
      }
      const ratio = close / list;
      if (!(ratio >= R_MIN && ratio <= R_MAX)) {
        dropped++;
        continue;
      }
      recs.push({
        key: r.listing_key,
        list,
        close,
        r: ratio,
        over: close > list,
        bidup: ratio >= 1.03,
        band: bandOf(list),
      });
    }
    if (page.length < READ_PAGE) break;
  }
  console.log(`   ${recs.length.toLocaleString()} usable closings (${dropped.toLocaleString()} dropped)\n`);
  if (!recs.length) {
    console.error('❌ no rows');
    process.exit(1);
  }

  const all = stats(recs);
  console.log(`ALL CLOSINGS        n=${all.n}  over-ask ${(all.overRate * 100).toFixed(1)}%  bid-up ${(all.bidupRate * 100).toFixed(1)}%  med c/l ${all.medRatio.toFixed(3)}`);

  // ── view 1: unconditional, every $1k band ──────────────────────────────────
  bandTable(recs, '── VIEW 1 · UNCONDITIONAL, by $1k remainder band ──', all.overRate);

  // ── view 2: restricted to below-comps homes ────────────────────────────────
  console.log(`\n📥 Loading AVM backtest run "${AVM_RUN}"…`);
  let avm: Map<string, number>;
  try {
    avm = await loadAvmRun(AVM_RUN);
  } catch (e) {
    console.error(`⚠️  could not load AVM run: ${e instanceof Error ? e.message : String(e)}`);
    console.error('   View 2 skipped. Re-run with --avm-run <id> once a backtest exists.');
    return;
  }
  console.log(`   ${avm.size.toLocaleString()} AVM estimates`);
  const withAvm = recs.filter((x) => avm.has(x.key));
  const below = withAvm.filter((x) => (avm.get(x.key) as number) >= x.list * (1 + MARGIN));
  console.log(`   ${withAvm.length.toLocaleString()} closings matched; ${below.length.toLocaleString()} listed >= ${(MARGIN * 100).toFixed(0)}% under comps`);
  if (below.length < MIN_N) {
    console.error(`⚠️  below-comps sample too thin (${below.length} < ${MIN_N}). View 2 skipped.`);
    return;
  }
  const belowStats = stats(below);
  const withAvmStats = stats(withAvm);
  console.log(
    `\nBELOW-COMPS (any digits)  n=${belowStats.n}  over-ask ${(belowStats.overRate * 100).toFixed(1)}%  bid-up ${(belowStats.bidupRate * 100).toFixed(1)}%  med c/l ${belowStats.medRatio.toFixed(3)}`,
  );
  console.log(
    `AVM-MATCHED CONTROL       n=${withAvmStats.n}  over-ask ${(withAvmStats.overRate * 100).toFixed(1)}%  bid-up ${(withAvmStats.bidupRate * 100).toFixed(1)}%  med c/l ${withAvmStats.medRatio.toFixed(3)}`,
  );
  bandTable(below, '── VIEW 2 · BELOW-COMPS ONLY, by $1k remainder band ──', belowStats.overRate);

  // ── the two production-relevant buckets, head to head ──────────────────────
  const isProdThreshold = (p: number) => mod(p, 100_000) >= 95_000;
  const prodFires = below.filter((x) => isProdThreshold(x.list));
  const prodMisses = below.filter((x) => !isProdThreshold(x.list));
  const s1 = stats(prodFires);
  const s2 = stats(prodMisses);
  console.log('\n── PRODUCTION GATE, on the below-comps population ──');
  console.log(`  detectCompetitive FIRES  (isThresholdPrice)  n=${s1.n}  over-ask ${(s1.overRate * 100).toFixed(1)}%  med c/l ${s1.medRatio.toFixed(3)}`);
  console.log(`  detectCompetitive MISSES (everything else)   n=${s2.n}  over-ask ${(s2.overRate * 100).toFixed(1)}%  med c/l ${s2.medRatio.toFixed(3)}`);
  console.log(
    `\n  ⇒ the gate currently discards ${s2.n.toLocaleString()} of ${below.length.toLocaleString()} below-comps homes ` +
      `(${((s2.n / below.length) * 100).toFixed(1)}%), whose own over-ask rate is ${(s2.overRate * 100).toFixed(1)}%.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
