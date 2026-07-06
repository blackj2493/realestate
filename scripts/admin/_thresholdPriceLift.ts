/**
 * (b) Threshold-price ("999") lift backtest.
 *
 * Tests the hypothesis: a list price ending in a charm/threshold pattern ($_99,000, just
 * under a round $100k / $1M) predicts that the home SELLS OVER ASK (a deliberate
 * under-list-for-a-bidding-war). Measured on held-out `raw_vow_sold` closings.
 *
 * Outcome measures per bucket:
 *   - over-ask rate  = P(close > list)
 *   - median close/list
 *   - "bid up" rate  = P(close/list >= 1.03)   (a real competition, not a $1k rounding)
 *   - lift           = over-ask rate(threshold) − over-ask rate(non-threshold)
 *
 * Controls: base rate of each detector, split by price tier (threshold pricing clusters
 * near the $1M line), and a natural-experiment "discontinuity" (just-UNDER $1M vs
 * just-OVER). Optional AVM interaction: within homes the AVM says are under-priced vs
 * comps, does threshold add further lift? (needs a prior avm-backtest run; skipped if
 * absent).
 *
 * Leakage note: raw_vow_sold.list_price is the LAST list (post-reduction) and has no
 * original_list_price scalar — homes bid up rarely had drops, so their last==original,
 * but this understates threshold coverage among price-cut homes. Stated in the report.
 *
 * READ-ONLY (§12). No writes. Deterministic (§4). Native fetch; *.supabase.co has a valid
 * cert so no TLS bypass.
 *
 *   npx.cmd tsx --env-file=.env scripts/admin/_thresholdPriceLift.ts --months 12
 *   npx.cmd tsx --env-file=.env scripts/admin/_thresholdPriceLift.ts --avm-run peers-2026-06-02
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
  return a.includes('=') ? a.split('=')[1] : process.argv[process.argv.indexOf(a) + 1] ?? def;
}

const MONTHS = numFlag('--months', 12);
const MIN_SALE = numFlag('--min-sale', 100000); // drop leases / junk
const AVM_RUN = strFlag('--avm-run', 'peers-2026-06-02');
const R_MIN = 0.3;
const R_MAX = 3.0; // drop mistyped-list artifacts
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

// ── threshold-price detectors (integer dollars) ──────────────────────────────
const mod = (n: number, m: number) => ((n % m) + m) % m;
const D = {
  'D1 $_99,000 exact': (p: number) => mod(p, 100000) === 99000,
  'D2 $_99,900 exact': (p: number) => mod(p, 100000) === 99900,
  'D3 top $5k of 100k band': (p: number) => mod(p, 100000) >= 95000,
  'D4 top $10k under round $1M': (p: number) => mod(p, 1000000) >= 990000,
} as const;
const isAnyThreshold = (p: number) => Object.values(D).some((f) => f(p));

// ── stats helpers ─────────────────────────────────────────────────────────────
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
function priceTier(p: number): string {
  if (p < 750_000) return '<750k';
  if (p < 1_000_000) return '750k-1M';
  if (p < 1_500_000) return '1M-1.5M';
  if (p < 2_000_000) return '1.5M-2M';
  return '2M+';
}

interface Rec {
  key: string;
  list: number;
  close: number;
  r: number;
  over: boolean;
  bidup: boolean;
  tier: string;
  sub: string;
}

function summarize(recs: Rec[]): string {
  if (!recs.length) return 'n=0';
  const over = recs.filter((x) => x.over).length;
  const bidup = recs.filter((x) => x.bidup).length;
  const med = median(recs.map((x) => x.r));
  return `n=${String(recs.length).padStart(6)}  over-ask ${((over / recs.length) * 100).toFixed(1).padStart(5)}%  bid-up≥3% ${((bidup / recs.length) * 100).toFixed(1).padStart(5)}%  med c/l ${med.toFixed(3)}`;
}

// ── raw_vow_sold streaming read ────────────────────────────────────────────────
interface Row {
  listing_key: string;
  close_price: number | null;
  list_price: number | null;
  purchase_contract_date: string | null;
  property_sub_type: string | null;
}
async function readPage(cursor: string, sinceIso: string): Promise<Row[] | null> {
  let attempt = 0;
  for (;;) {
    const { data, error } = await sb
      .from('raw_vow_sold')
      .select('listing_key, close_price, list_price, purchase_contract_date, property_sub_type')
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

async function main() {
  console.log('========================================');
  console.log('  (b) Threshold-price ("999") lift backtest');
  console.log(`  window: last ${MONTHS} mo of raw_vow_sold  ·  close>=$${MIN_SALE.toLocaleString()}  ·  c/l band ${R_MIN}-${R_MAX}`);
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
      if (ratio < R_MIN || ratio > R_MAX) {
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
        tier: priceTier(close),
        sub: (r.property_sub_type || '?').trim(),
      });
    }
    if (recs.length % 20000 < READ_PAGE) console.log(`   …loaded ${recs.length}`);
    if (page.length < READ_PAGE) break;
  }
  console.log(`   usable closings: ${recs.length.toLocaleString()}  (dropped ${dropped} no-list/out-of-band)\n`);

  console.log('════════ Baseline (all closings) ════════');
  console.log(`  ${summarize(recs)}\n`);

  console.log('════════ Per detector: threshold vs NOT ════════');
  for (const [name, fn] of Object.entries(D)) {
    const yes = recs.filter((x) => fn(x.list));
    const no = recs.filter((x) => !fn(x.list));
    const liftOver =
      yes.length && no.length
        ? (yes.filter((x) => x.over).length / yes.length - no.filter((x) => x.over).length / no.length) * 100
        : NaN;
    console.log(`  ${name}   (base rate ${((yes.length / recs.length) * 100).toFixed(1)}%)`);
    console.log(`    threshold : ${summarize(yes)}`);
    console.log(`    NOT       : ${summarize(no)}`);
    console.log(`    → over-ask LIFT: ${Number.isFinite(liftOver) ? (liftOver >= 0 ? '+' : '') + liftOver.toFixed(1) + ' pts' : 'n/a'}\n`);
  }

  console.log('════════ Natural experiment: just-UNDER vs just-OVER a round $1M ════════');
  const justUnder = recs.filter((x) => x.list >= 985_000 && x.list <= 999_999);
  const justOver = recs.filter((x) => x.list >= 1_000_000 && x.list <= 1_030_000);
  console.log(`  list $985k–$999,999 (strategic under): ${summarize(justUnder)}`);
  console.log(`  list $1.00M–$1.03M  (priced at value): ${summarize(justOver)}\n`);

  console.log('════════ Control: D3 (union) over-ask% by price tier ════════');
  for (const t of ['<750k', '750k-1M', '1M-1.5M', '1.5M-2M', '2M+']) {
    const inTier = recs.filter((x) => x.tier === t);
    if (inTier.length < 50) continue;
    const yes = inTier.filter((x) => isAnyThreshold(x.list));
    const no = inTier.filter((x) => !isAnyThreshold(x.list));
    const ov = (a: Rec[]) => (a.length ? ((a.filter((x) => x.over).length / a.length) * 100).toFixed(1) + '%' : 'n/a');
    console.log(`  ${t.padEnd(9)}  threshold ${ov(yes).padStart(6)} (n=${yes.length})   NOT ${ov(no).padStart(6)} (n=${no.length})`);
  }
  console.log('');

  // ── Optional AVM interaction ─────────────────────────────────────────────────
  console.log(`📥 Trying AVM run "${AVM_RUN}" for the AVM×threshold cross-tab…`);
  let avm: Map<string, number> = new Map();
  try {
    avm = await loadAvmRun(AVM_RUN);
  } catch (e) {
    console.warn(`   ⚠️ AVM load failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (avm.size === 0) {
    console.log('   (no AVM rows for that run — skipping AVM×threshold. Run avm-backtest.ts to enable.)\n');
  } else {
    const withAvm = recs.filter((x) => avm.has(x.key)).map((x) => ({ ...x, sig: (avm.get(x.key)! - x.list) / x.list }));
    console.log(`   joined ${withAvm.length} homes on AVM.\n`);
    console.log('════════ AVM says under-priced (AVM>list) × threshold ════════');
    const under = withAvm.filter((x) => x.sig > 0.05); // AVM >5% above ask = under-priced vs comps
    const q = (a: typeof under) => (a.length ? ((a.filter((x) => x.over).length / a.length) * 100).toFixed(1) + '%' : 'n/a');
    const uT = under.filter((x) => isAnyThreshold(x.list));
    const uN = under.filter((x) => !isAnyThreshold(x.list));
    console.log(`  AVM>list & threshold : over-ask ${q(uT)}  (n=${uT.length})  med c/l ${median(uT.map((x) => x.r)).toFixed(3)}`);
    console.log(`  AVM>list & NOT thresh: over-ask ${q(uN)}  (n=${uN.length})  med c/l ${median(uN.map((x) => x.r)).toFixed(3)}`);
    console.log(`  → does threshold add lift ON TOP of the AVM signal? compare the two rows above.\n`);
  }

  console.log('✅ Done.');
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
