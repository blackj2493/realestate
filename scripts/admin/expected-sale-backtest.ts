/**
 * Shadow MLS — Expected-Sale-Price out-of-time backtest (plan how-do-we-moonlit-tarjan,
 * companion to the list-BLIND AVM backtest avm-backtest.ts).
 *
 * THE SECOND NUMBER. The independent AVM answers "what should a similar home go for
 * in this area?" (list-blind, ~11% median |%err| — its accuracy is capped because the
 * deciding ~15% of price, condition/finish/micro-location, lives in the listing agent's
 * private knowledge, which §4 forbids extracting from remarks/photos). The Expected
 * Sale Price answers the *other* question — "what will THIS listing actually close at?"
 * — by using the one public field that already embeds that private knowledge: the
 * LIST PRICE. It is deterministic and list-aware:
 *
 *     ExpectedSale = list_price × R(cohort, market-temperature as-of t_S)
 *
 * where R is a robust, leakage-safe estimate of the close/list ratio from comparable
 * homes that had already CLOSED before the subject was listed. This harness measures
 * R in four escalating forms and reports each vs the actual ClosePrice:
 *
 *   M0  raw last list           ExpectedSale = list                (R ≡ 1)   — the floor
 *   M1  sub-type market ratio    R = median(close/list) over the sub-type, trailing
 *                                GLOBAL_MO (captures market temperature + sub-type level)
 *   M2  localized ratio          R = cohort (city_region×sub) close/list, trailing
 *                                RATIO_WINDOW_MO, hierarchically shrunk cohort→city→sub
 *   M3  localized + recency       M2's cohort ladder over a short RECENT_MO window,
 *                                shrunk toward M2 (adapts to a turning market)
 *
 * It then JOINS the list-blind AVM (avm_backtest_results, run --avm-run) on the SAME
 * held-out homes to (a) compare the two numbers apples-to-apples and (b) test the
 * product thesis: the GAP between the intrinsic AVM and the ask is the arbitrage a
 * deal-hunter looks for — i.e. does (AVM − list)/list predict how far above/below ask
 * the home actually closes?
 *
 * LEAKAGE IS THE CORE DISCIPLINE (only data dated < t_S may inform an estimate):
 *   - Reference date = purchase_contract_date (deal signing), never close_date.
 *   - R is built ONLY from comps whose deal MONTH is strictly before the subject's
 *     deal month (monthsBackList excludes the subject's own month) and within the
 *     window — so every contributing close/list was known before the subject listed.
 *   - close/list of a comp is known at the comp's close, which is < t_S. No look-ahead.
 *   - The subject is never in its own comp set (months are strictly earlier).
 *
 * HONEST CAVEAT (stated in the report): R is fit on the LAST list of SOLD homes, which
 * already absorbed any price drops. A fresh ACTIVE listing whose list may still drop
 * will be modestly worse than this number — this is the optimistic bound. raw_vow_sold
 * has list_price (100% filled) but NO original_list_price scalar, so original→close is
 * not measurable here without a JSONB scan (§ IO budget); documented as a follow-on.
 *
 * 100% deterministic, no AI (CLAUDE.md §4 — list_price is public/IDX-displayable, fine
 * to use). raw_vow_sold is READ-ONLY (§12); this harness writes NOTHING to the DB — it
 * prints a report and optionally a JSON to --json-out for re-analysis. IO-frugal: scalar
 * columns only, keyset pagination, bounded window, retry/backoff (cf. avm-backtest.ts and
 * the supabase-io-budget memory).
 *
 * Usage (run where .env with Supabase creds lives):
 *   npx.cmd tsx --env-file=.env scripts/admin/expected-sale-backtest.ts --limit 3000
 *   npx.cmd tsx --env-file=.env scripts/admin/expected-sale-backtest.ts --avm-run peers-2026-06-02
 */

// MUST set TLS env var BEFORE importing the supabase client.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import * as https from 'https';
import * as fs from 'fs';
import crossFetch from 'cross-fetch';
import {
  normalizePropertySubType,
  cityRegionLookupCandidates,
  rawVariantsOf,
} from '@/lib/avm/normalizeType';
import { MIN_SALE_PRICE as DEFAULT_SALE_PRICE_FLOOR } from '@/lib/avm/types';

const agent = new https.Agent({ rejectUnauthorized: false });
(global as unknown as { fetch: typeof fetch }).fetch = ((url: RequestInfo | URL, init?: RequestInit) =>
  // @ts-expect-error agent is a node-fetch option, not standard
  crossFetch(url, { ...init, agent })) as typeof fetch;

// ── CLI flags ────────────────────────────────────────────────────────────────
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
const EVAL_MONTHS = numFlag('--eval-months', 6);
const EVAL_LIMIT = numFlag('--limit', Infinity);
const RATIO_WINDOW_MO = numFlag('--ratio-window-mo', 12); // M2 cohort window
const RECENT_MO = numFlag('--recent-mo', 4); // M3 recency window
const GLOBAL_MO = numFlag('--global-mo', 6); // M1 sub-type market window
const SHRINK_K = numFlag('--shrink-k', 12); // cohort→city→sub partial-pooling strength
const SHRINK_K3 = numFlag('--shrink-k3', 8); // M3 recent→stable blend strength
const MIN_SALE_PRICE = numFlag('--min-sale-price', DEFAULT_SALE_PRICE_FLOOR);
const AVM_RUN = strFlag('--avm-run', 'peers-2026-06-02');
const JSON_OUT = strFlag('--json-out', '');
// close/list sanity band — drop obvious data errors (mistyped list, relist artifacts).
// Medians are robust, but a list typed as $30k on a $1.5M home (r≈50) is garbage, not signal.
const R_MIN = 0.3;
const R_MAX = 3.0;

// ── IO pacing ──────────────────────────────────────────────────────────────────
const READ_PAGE = 1000;
const INTER_CHUNK_DELAY_MS = 200;
const MAX_READ_RETRIES = 5;

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

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface PoolRow {
  listing_key: string;
  close_price: number | null;
  list_price: number | null;
  purchase_contract_date: string | null;
  close_date: string | null;
  city: string | null;
  city_region: string | null;
  property_sub_type: string | null;
}
interface Sale extends PoolRow {
  refDate: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  normSub: string;
  cityLower: string;
  cityRegionTrim: string;
  lnr: number | null; // ln(close/list), null if unusable/out-of-band
}

const SELECT_COLS =
  'listing_key, close_price, list_price, purchase_contract_date, close_date, city, city_region, property_sub_type';

// ─────────────────────────────────────────────────────────────────────────────
// Date / stat helpers
// ─────────────────────────────────────────────────────────────────────────────
function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
/** The `count` calendar months strictly BEFORE `month` (YYYY-MM), most-recent first. */
function monthsBackList(month: string, count: number): string[] {
  let [y, m] = month.split('-').map(Number); // m is 1-based
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}
function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
function priceTier(p: number): string {
  if (p < 500_000) return '<500k';
  if (p < 750_000) return '500k-750k';
  if (p < 1_000_000) return '750k-1M';
  if (p < 1_500_000) return '1M-1.5M';
  if (p < 2_000_000) return '1.5M-2M';
  return '2M+';
}

// ─────────────────────────────────────────────────────────────────────────────
// raw_vow_sold streaming read (keyset on listing_key, retry/backoff)
// ─────────────────────────────────────────────────────────────────────────────
async function readPoolPage(cursor: string, windowStartIso: string): Promise<PoolRow[] | null> {
  let attempt = 0;
  for (;;) {
    const { data, error } = await sb
      .from('raw_vow_sold')
      .select(SELECT_COLS)
      .gt('listing_key', cursor)
      .gte('purchase_contract_date', windowStartIso)
      .gte('close_price', MIN_SALE_PRICE)
      .order('listing_key', { ascending: true })
      .limit(READ_PAGE);
    if (!error) return data as unknown as PoolRow[] | null;
    attempt++;
    if (attempt > MAX_READ_RETRIES) {
      throw new Error(`read failed at "${cursor}" after ${MAX_READ_RETRIES} retries: ${error.message}`);
    }
    const backoff = Math.min(30000, 3000 * 2 ** (attempt - 1));
    console.warn(`   ⏳ read error at "${cursor}" (${attempt}/${MAX_READ_RETRIES}): ${error.message} — backoff ${backoff}ms`);
    await sleep(backoff);
  }
}

interface AvmResultRow {
  listing_key: string;
  estimated_value: number | null;
  close_price: number | null;
}

/** Load the list-blind AVM estimates from a prior avm-backtest run (clean only). */
async function loadAvmRun(runId: string): Promise<Map<string, { avm: number; close: number }>> {
  const out = new Map<string, { avm: number; close: number }>();
  let cursor = '';
  for (;;) {
    let attempt = 0;
    let data: AvmResultRow[] | null = null;
    for (;;) {
      const res = await sb
        .from('avm_backtest_results')
        .select('listing_key, estimated_value, close_price')
        .eq('backtest_run_id', runId)
        .eq('leaky', false)
        .gt('listing_key', cursor)
        .order('listing_key', { ascending: true })
        .limit(READ_PAGE);
      if (!res.error) {
        data = res.data as unknown as AvmResultRow[];
        break;
      }
      attempt++;
      if (attempt > MAX_READ_RETRIES) throw new Error(`avm run load failed: ${res.error.message}`);
      await sleep(Math.min(30000, 3000 * 2 ** (attempt - 1)));
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      cursor = r.listing_key;
      if (r.estimated_value && r.estimated_value > 0 && r.close_price && r.close_price > 0) {
        out.set(r.listing_key, { avm: r.estimated_value, close: r.close_price });
      }
    }
    if (data.length < READ_PAGE) break;
    await sleep(INTER_CHUNK_DELAY_MS);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// close/list ratio buckets (per tier) → leakage-safe as-of windowed medians
// ─────────────────────────────────────────────────────────────────────────────
type MonthMap = Map<string, number[]>; // month 'YYYY-MM' → lnr values
const cohortB = new Map<string, MonthMap>(); // `${cityRegionTrim}␟${subVerbatim}`
const cityB = new Map<string, MonthMap>(); //   `${cityLower}␟${normSub}`
const subB = new Map<string, MonthMap>(); //    `${normSub}`

function pushBucket(b: Map<string, MonthMap>, key: string, month: string, v: number): void {
  let mm = b.get(key);
  if (!mm) {
    mm = new Map();
    b.set(key, mm);
  }
  let arr = mm.get(month);
  if (!arr) {
    arr = [];
    mm.set(month, arr);
  }
  arr.push(v);
}

// memoized windowed median per (tier, identity, anchor-month, window)
const wmedMemo = new Map<string, { med: number; n: number } | null>();
function windowedMedian(
  b: Map<string, MonthMap>,
  keys: string[],
  months: string[],
  memoTag: string
): { med: number; n: number } | null {
  const cached = wmedMemo.get(memoTag);
  if (cached !== undefined) return cached;
  const vals: number[] = [];
  for (const key of keys) {
    const mm = b.get(key);
    if (!mm) continue;
    for (const mo of months) {
      const arr = mm.get(mo);
      if (arr) for (const v of arr) vals.push(v);
    }
  }
  const res = vals.length ? { med: median(vals), n: vals.length } : null;
  wmedMemo.set(memoTag, res);
  return res;
}

/** Hierarchically-shrunk ln(close/list) for a cohort, as-of `subjectMonth`, over `win`
 *  trailing months: cohort (city_region×sub, candidate/variant-expanded) shrunk toward
 *  city (city×sub) shrunk toward sub-type-global. Returns the shrunk ln-ratio plus the
 *  cohort-level sample count (for M3's recency blend). */
function shrunkLnRatio(
  subjectMonth: string,
  win: number,
  cohortKeys: string[],
  cohortIdentity: string,
  cityKey: string,
  subKey: string
): { ln: number; nCohort: number } {
  const months = monthsBackList(subjectMonth, win);
  const tag = `${subjectMonth}|${win}`;
  const a = windowedMedian(subB, [subKey], months, `A␟${subKey}␟${tag}`);
  const b = windowedMedian(cityB, [cityKey], months, `B␟${cityKey}␟${tag}`);
  const c = windowedMedian(cohortB, cohortKeys, months, `C␟${cohortIdentity}␟${tag}`);
  const lnA = a ? a.med : 0; // R=1 if even the sub-type has no data (degenerate)
  const lnB = b ? (b.n * b.med + SHRINK_K * lnA) / (b.n + SHRINK_K) : lnA;
  const lnC = c ? (c.n * c.med + SHRINK_K * lnB) / (c.n + SHRINK_K) : lnB;
  return { ln: lnC, nCohort: c ? c.n : 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-model error accumulation
// ─────────────────────────────────────────────────────────────────────────────
interface Acc {
  abs: number[]; // |%err|
  logs: number[]; // ln(expected/close)
}
function newAcc(): Acc {
  return { abs: [], logs: [] };
}
function add(acc: Acc, expected: number, close: number): void {
  acc.abs.push(Math.abs(expected - close) / close);
  acc.logs.push(Math.log(expected) - Math.log(close));
}
function report(acc: Acc): string {
  if (acc.abs.length === 0) return 'n/a';
  const m = median(acc.abs) * 100;
  const mape = mean(acc.abs) * 100;
  const bias = mean(acc.logs);
  const hit = (t: number) => ((acc.abs.filter((x) => x <= t).length / acc.abs.length) * 100).toFixed(1);
  return `med ${m.toFixed(2)}%  MAPE ${mape.toFixed(2)}%  bias ${bias >= 0 ? '+' : ''}${bias.toFixed(4)}  hit±5/10/20 ${hit(0.05)}/${hit(0.1)}/${hit(0.2)}%  n=${acc.abs.length}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log('  Expected-Sale-Price out-of-time backtest');
  console.log(`  eval window: last ${EVAL_MONTHS} mo  ·  ratio windows: cohort ${RATIO_WINDOW_MO}mo / recent ${RECENT_MO}mo / market ${GLOBAL_MO}mo`);
  console.log(`  shrink K=${SHRINK_K} (cohort→city→sub), K3=${SHRINK_K3} (recent→stable)`);
  console.log(`  lease filter: close_price >= $${MIN_SALE_PRICE.toLocaleString()}  ·  ratio sanity band: ${R_MIN}–${R_MAX}`);
  console.log(`  AVM comparison run: ${AVM_RUN}`);
  if (Number.isFinite(EVAL_LIMIT)) console.log(`  eval limit: ${EVAL_LIMIT}`);
  console.log('========================================\n');

  const evalWindowStart = monthsAgoIso(EVAL_MONTHS);
  const poolWindowStart = monthsAgoIso(EVAL_MONTHS + RATIO_WINDOW_MO + 1);

  console.log(`📥 Streaming raw_vow_sold (purchase_contract_date >= ${poolWindowStart})…`);
  const pool: Sale[] = [];
  let cursor = '';
  let usableR = 0,
    outOfBand = 0,
    noList = 0;
  for (;;) {
    let page: PoolRow[] | null;
    try {
      page = await readPoolPage(cursor, poolWindowStart);
    } catch (e) {
      console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
      return;
    }
    if (!page || page.length === 0) break;
    for (const r of page) {
      cursor = r.listing_key;
      const refDate = (r.purchase_contract_date || r.close_date || '').slice(0, 10);
      if (!refDate) continue;
      const normSub = normalizePropertySubType(r.property_sub_type);
      const cityLower = (r.city || '').trim().toLowerCase();
      const cityRegionTrim = (r.city_region || '').trim();
      // close/list ratio for this row (it becomes a comp for later subjects).
      let lnr: number | null = null;
      if (r.close_price && r.close_price > 0) {
        if (r.list_price && r.list_price > 0) {
          const ratio = r.close_price / r.list_price;
          if (ratio >= R_MIN && ratio <= R_MAX) {
            lnr = Math.log(ratio);
            usableR++;
          } else {
            outOfBand++;
          }
        } else {
          noList++;
        }
      }
      const s: Sale = {
        ...r,
        refDate,
        month: refDate.slice(0, 7),
        normSub,
        cityLower,
        cityRegionTrim,
        lnr,
      };
      pool.push(s);
      // Index this row's ratio into all three tiers (only if usable).
      if (lnr !== null && normSub) {
        if (cityRegionTrim && r.property_sub_type) {
          pushBucket(cohortB, `${cityRegionTrim}␟${r.property_sub_type}`, s.month, lnr);
        }
        if (cityLower) pushBucket(cityB, `${cityLower}␟${normSub}`, s.month, lnr);
        pushBucket(subB, normSub, s.month, lnr);
      }
    }
    if (pool.length % 20000 < READ_PAGE) console.log(`   …pooled ${pool.length} (last key ${cursor})`);
    if (page.length < READ_PAGE) break;
    await sleep(INTER_CHUNK_DELAY_MS);
  }
  const listFill = usableR + outOfBand + noList > 0 ? (usableR + outOfBand) / (usableR + outOfBand + noList) : 0;
  console.log(`   pool size: ${pool.length}`);
  console.log(`   list_price present: ${((listFill) * 100).toFixed(1)}%  ·  usable ratios: ${usableR}  ·  out-of-band dropped: ${outOfBand}  ·  no list: ${noList}\n`);

  // Eval set: sales in the last EVAL_MONTHS with a usable list price + cohort, recent first.
  let evalSales = pool
    .filter((s) => s.refDate >= evalWindowStart && s.normSub && s.cityRegionTrim && s.lnr !== null && s.close_price && s.list_price)
    .sort((a, b) => (a.refDate < b.refDate ? 1 : a.refDate > b.refDate ? -1 : 0));
  if (Number.isFinite(EVAL_LIMIT)) evalSales = evalSales.slice(0, EVAL_LIMIT);
  console.log(`🎯 Evaluating ${evalSales.length} held-out sales…\n`);

  // ── Accumulators ────────────────────────────────────────────────────────────
  const G = { m0: newAcc(), m1: newAcc(), m2: newAcc(), m3: newAcc() };
  const bySub = new Map<string, { m0: Acc; m1: Acc; m2: Acc; m3: Acc }>();
  const byTier = new Map<string, { m0: Acc; m1: Acc; m2: Acc; m3: Acc }>();
  const ensure = (m: Map<string, { m0: Acc; m1: Acc; m2: Acc; m3: Acc }>, k: string) => {
    let v = m.get(k);
    if (!v) {
      v = { m0: newAcc(), m1: newAcc(), m2: newAcc(), m3: newAcc() };
      m.set(k, v);
    }
    return v;
  };

  // Per-row records (for the AVM join + JSON dump).
  interface Rec {
    listing_key: string;
    close: number;
    list: number;
    m0: number;
    m1: number;
    m2: number;
    m3: number;
    tier: string;
    sub: string;
  }
  const recs: Rec[] = [];

  let done = 0;
  for (const s of evalSales) {
    const close = s.close_price as number;
    const list = s.list_price as number;
    const cohortKeys: string[] = [];
    for (const cand of cityRegionLookupCandidates(s.cityRegionTrim)) {
      for (const variant of rawVariantsOf(s.normSub, s.property_sub_type || '')) {
        cohortKeys.push(`${cand}␟${variant}`);
      }
    }
    const cohortIdentity = `${s.cityRegionTrim}|${s.normSub}|${s.property_sub_type ?? ''}`;
    const cityKey = `${s.cityLower}␟${s.normSub}`;
    const subKey = s.normSub;

    // M0 — raw last list.
    const m0 = list;
    // M1 — sub-type market ratio over GLOBAL_MO (pure market temperature + sub level).
    const a1 = windowedMedian(subB, [subKey], monthsBackList(s.month, GLOBAL_MO), `M1␟${subKey}␟${s.month}|${GLOBAL_MO}`);
    const m1 = list * Math.exp(a1 ? a1.med : 0);
    // M2 — localized, hierarchically-shrunk ratio over RATIO_WINDOW_MO.
    const r2 = shrunkLnRatio(s.month, RATIO_WINDOW_MO, cohortKeys, cohortIdentity, cityKey, subKey);
    const m2 = list * Math.exp(r2.ln);
    // M3 — localized + recency: cohort ladder over RECENT_MO, shrunk toward M2.
    const rRecent = shrunkLnRatio(s.month, RECENT_MO, cohortKeys, cohortIdentity, cityKey, subKey);
    const ln3 = (rRecent.nCohort * rRecent.ln + SHRINK_K3 * r2.ln) / (rRecent.nCohort + SHRINK_K3);
    const m3 = list * Math.exp(ln3);

    add(G.m0, m0, close);
    add(G.m1, m1, close);
    add(G.m2, m2, close);
    add(G.m3, m3, close);
    const tier = priceTier(close);
    const sv = ensure(bySub, s.normSub);
    add(sv.m0, m0, close);
    add(sv.m1, m1, close);
    add(sv.m2, m2, close);
    add(sv.m3, m3, close);
    const tv = ensure(byTier, tier);
    add(tv.m0, m0, close);
    add(tv.m1, m1, close);
    add(tv.m2, m2, close);
    add(tv.m3, m3, close);

    recs.push({ listing_key: s.listing_key, close, list, m0, m1, m2, m3, tier, sub: s.normSub });
    if (++done % 5000 === 0) console.log(`   …evaluated ${done}/${evalSales.length}`);
  }

  // ── Report: headline model comparison ────────────────────────────────────────
  console.log('\n════════ Expected Sale Price — model comparison (all held-out sales) ════════');
  console.log(`  M0 raw last list      : ${report(G.m0)}`);
  console.log(`  M1 sub-type mkt ratio : ${report(G.m1)}`);
  console.log(`  M2 localized (shrunk) : ${report(G.m2)}`);
  console.log(`  M3 localized + recency: ${report(G.m3)}`);

  console.log('\n──── by sub-type (median |%err|: M0 → M1 → M2 → M3, n) ────');
  const subsByN = [...bySub.entries()].sort((a, b) => b[1].m0.abs.length - a[1].m0.abs.length);
  for (const [k, v] of subsByN) {
    if (v.m0.abs.length < 50) continue;
    const med = (acc: Acc) => (median(acc.abs) * 100).toFixed(2) + '%';
    console.log(`  ${k.padEnd(18)} ${med(v.m0).padStart(7)} → ${med(v.m1).padStart(7)} → ${med(v.m2).padStart(7)} → ${med(v.m3).padStart(7)}   n=${v.m0.abs.length}`);
  }

  console.log('\n──── by price tier (median |%err|: M0 → M1 → M2 → M3, n) ────');
  const tierOrder = ['<500k', '500k-750k', '750k-1M', '1M-1.5M', '1.5M-2M', '2M+'];
  for (const t of tierOrder) {
    const v = byTier.get(t);
    if (!v) continue;
    const med = (acc: Acc) => (median(acc.abs) * 100).toFixed(2) + '%';
    console.log(`  ${t.padEnd(10)} ${med(v.m0).padStart(7)} → ${med(v.m1).padStart(7)} → ${med(v.m2).padStart(7)} → ${med(v.m3).padStart(7)}   n=${v.m0.abs.length}`);
  }

  // ── AVM join: apples-to-apples on shared homes + arbitrage-signal test ────────
  console.log(`\n📥 Loading list-blind AVM estimates (run ${AVM_RUN})…`);
  let avmMap: Map<string, { avm: number; close: number }>;
  try {
    avmMap = await loadAvmRun(AVM_RUN);
  } catch (e) {
    console.warn(`   ⚠️ could not load AVM run: ${e instanceof Error ? e.message : String(e)} — skipping AVM comparison.`);
    avmMap = new Map();
  }

  if (avmMap.size > 0) {
    console.log(`   AVM rows: ${avmMap.size}`);
    const both: Array<{ list: number; close: number; avm: number; expected: number }> = [];
    const avmAcc = newAcc();
    const expAcc = newAcc(); // best model = M2 (or whichever the report shows wins)
    for (const r of recs) {
      const a = avmMap.get(r.listing_key);
      if (!a) continue;
      avmAcc.abs.push(Math.abs(a.avm - r.close) / r.close);
      avmAcc.logs.push(Math.log(a.avm) - Math.log(r.close));
      add(expAcc, r.m2, r.close);
      both.push({ list: r.list, close: r.close, avm: a.avm, expected: r.m2 });
    }
    console.log(`\n════════ Apples-to-apples on the ${both.length} homes in BOTH backtests ════════`);
    console.log(`  List-blind AVM    ("what a similar home should go for"): ${report(avmAcc)}`);
    console.log(`  Expected Sale (M2)("what THIS listing will close at")   : ${report(expAcc)}`);

    // Arbitrage-signal test: does (AVM − list)/list predict close-vs-list?
    // signal > 0  ⇒ AVM thinks the home is worth MORE than ask ⇒ a potential deal.
    // We bucket by signal and show the realized close/list (the outcome). If higher
    // signal ⇒ higher close/list (monotone), the gap is a real, tradable signal.
    console.log('\n════════ Arbitrage signal: does (AVM − list)/list predict close/list? ════════');
    const bins: Array<{ label: string; lo: number; hi: number; cl: number[]; cvsAvm: number[] }> = [
      { label: 'AVM ≪ ask  (signal < −15%)', lo: -Infinity, hi: -0.15, cl: [], cvsAvm: [] },
      { label: 'AVM < ask  (−15%..−5%)', lo: -0.15, hi: -0.05, cl: [], cvsAvm: [] },
      { label: 'AVM ≈ ask  (−5%..+5%)', lo: -0.05, hi: 0.05, cl: [], cvsAvm: [] },
      { label: 'AVM > ask  (+5%..+15%)', lo: 0.05, hi: 0.15, cl: [], cvsAvm: [] },
      { label: 'AVM ≫ ask  (signal > +15%)', lo: 0.15, hi: Infinity, cl: [], cvsAvm: [] },
    ];
    for (const x of both) {
      const signal = (x.avm - x.list) / x.list;
      const b = bins.find((bb) => signal >= bb.lo && signal < bb.hi);
      if (!b) continue;
      b.cl.push(x.close / x.list); // realized close-to-list
      b.cvsAvm.push(x.close / x.avm); // realized close-to-AVM
    }
    console.log('  signal bin                       n     median close/list   median close/AVM');
    for (const b of bins) {
      if (b.cl.length === 0) {
        console.log(`  ${b.label.padEnd(30)}  ${String(0).padStart(5)}   —`);
        continue;
      }
      console.log(
        `  ${b.label.padEnd(30)}  ${String(b.cl.length).padStart(5)}   ${median(b.cl).toFixed(3).padStart(12)}      ${median(b.cvsAvm).toFixed(3).padStart(10)}`
      );
    }
    console.log('\n  Read: if "median close/list" RISES down the table (AVM≪ask → AVM≫ask), the gap');
    console.log('  is predictive — homes the AVM flags as under-priced vs ask close nearer/above ask.');
  }

  // ── Optional JSON dump ────────────────────────────────────────────────────────
  if (JSON_OUT) {
    try {
      fs.writeFileSync(
        JSON_OUT,
        JSON.stringify(
          {
            params: { EVAL_MONTHS, RATIO_WINDOW_MO, RECENT_MO, GLOBAL_MO, SHRINK_K, SHRINK_K3, MIN_SALE_PRICE, AVM_RUN },
            n: recs.length,
            recs,
          },
          null,
          0
        )
      );
      console.log(`\n💾 Wrote per-home records to ${JSON_OUT}`);
    } catch (e) {
      console.warn(`   ⚠️ JSON dump failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log('\n✅ Done.');
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
