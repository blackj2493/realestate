/**
 * THROWAWAY sweep harness (delete after): stream the held-out sold pool ONCE, then evaluate
 * MANY close/list-ratio models in-memory to (a) measure what the LIVE production path
 * (getCloseListRatio: flat 6-mo city×sub median + city-all fallback) actually scores, (b)
 * sweep the research levers (hierarchical shrink K, ratio window, recency) to find the best
 * config, and (c) calibrate the displayed band (EXPECTED_SALE_REL_HALF_WIDTH) to real
 * coverage, overall + by cohort support. Leakage-safe (comps strictly before the subject's
 * deal month). Read-only on raw_vow_sold; writes nothing to the DB. Standard TLS.
 *
 *   npx.cmd tsx --env-file=.env scripts/admin/_es-sweep.ts --limit 40000
 *   npx.cmd tsx --env-file=.env scripts/admin/_es-sweep.ts --refresh   # re-stream the pool
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import {
  normalizePropertySubType,
  cityRegionLookupCandidates,
  rawVariantsOf,
} from '@/lib/avm/normalizeType';
import { MIN_SALE_PRICE } from '@/lib/avm/types';

function num(name: string, def: number): number {
  const a = process.argv.find((x) => x.startsWith(name));
  if (!a) return def;
  const raw = a.includes('=') ? a.split('=')[1] : process.argv[process.argv.indexOf(a) + 1];
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}
const has = (name: string) => process.argv.includes(name);
const EVAL_MONTHS = num('--eval-months', 6);
const LIMIT = num('--limit', 40000);
const GLOBAL_MO = 6;
const R_MIN = 0.3, R_MAX = 3.0;
const CACHE = '.es-pool-cache.json';

const sb = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim(),
  (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function priceTier(p: number): string {
  if (p < 500_000) return '<500k';
  if (p < 750_000) return '500-750k';
  if (p < 1_000_000) return '750k-1M';
  if (p < 1_500_000) return '1-1.5M';
  if (p < 2_000_000) return '1.5-2M';
  return '2M+';
}
function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
function monthsBackList(month: string, count: number): string[] {
  let [y, m] = month.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    m--;
    if (m === 0) { m = 12; y--; }
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

interface Raw { lk: string; close: number; list: number; ref: string; city: string; cr: string; sub: string }
interface Sale extends Raw { month: string; normSub: string; lnr: number | null }

const SELECT = 'listing_key, close_price, list_price, purchase_contract_date, close_date, city, city_region, property_sub_type';

async function streamPool(windowStart: string): Promise<Raw[]> {
  const rows: Raw[] = [];
  let cursor = '';
  for (;;) {
    let attempt = 0;
    let data: Record<string, unknown>[] | null = null;
    for (;;) {
      const res = await sb.from('raw_vow_sold').select(SELECT)
        .gt('listing_key', cursor).gte('purchase_contract_date', windowStart)
        .gte('close_price', MIN_SALE_PRICE).order('listing_key', { ascending: true }).limit(1000);
      if (!res.error) { data = res.data as Record<string, unknown>[]; break; }
      if (++attempt > 5) throw new Error(res.error.message);
      await sleep(Math.min(30000, 2000 * 2 ** (attempt - 1)));
    }
    if (!data || !data.length) break;
    for (const r of data) {
      cursor = r.listing_key as string;
      const ref = ((r.purchase_contract_date as string) || (r.close_date as string) || '').slice(0, 10);
      if (!ref) continue;
      rows.push({
        lk: r.listing_key as string, close: Number(r.close_price), list: Number(r.list_price),
        ref, city: (r.city as string) || '', cr: (r.city_region as string) || '', sub: (r.property_sub_type as string) || '',
      });
    }
    if (rows.length % 40000 < 1000) console.log(`   …pooled ${rows.length}`);
    if (data.length < 1000) break;
    await sleep(120);
  }
  return rows;
}

// ── buckets: month 'YYYY-MM' → lnr[] ─────────────────────────────────────────
type MonthMap = Map<string, number[]>;
const cohortB = new Map<string, MonthMap>(); // community×subVerbatim
const cityB = new Map<string, MonthMap>();    // municipality×normSub
const cityAllB = new Map<string, MonthMap>(); // municipality (any sub)  ← for live fallback
const subB = new Map<string, MonthMap>();     // normSub
function push(b: Map<string, MonthMap>, key: string, month: string, v: number) {
  let mm = b.get(key); if (!mm) { mm = new Map(); b.set(key, mm); }
  let arr = mm.get(month); if (!arr) { arr = []; mm.set(month, arr); }
  arr.push(v);
}
const memo = new Map<string, { med: number; n: number } | null>();
function wmed(b: Map<string, MonthMap>, keys: string[], months: string[], tag: string) {
  const c = memo.get(tag); if (c !== undefined) return c;
  const vals: number[] = [];
  for (const k of keys) { const mm = b.get(k); if (!mm) continue; for (const mo of months) { const a = mm.get(mo); if (a) for (const v of a) vals.push(v); } }
  const res = vals.length ? { med: median(vals), n: vals.length } : null;
  memo.set(tag, res); return res;
}
function shrunk(month: string, win: number, k: number, cohortKeys: string[], cohortId: string, cityKey: string, subKey: string) {
  const months = monthsBackList(month, win);
  const tag = `${month}|${win}`;
  const a = wmed(subB, [subKey], months, `A␟${subKey}␟${tag}`);
  const b = wmed(cityB, [cityKey], months, `B␟${cityKey}␟${tag}`);
  const c = wmed(cohortB, cohortKeys, months, `C␟${cohortId}␟${tag}`);
  const lnA = a ? a.med : 0;
  const lnB = b ? (b.n * b.med + k * lnA) / (b.n + k) : lnA;
  const lnC = c ? (c.n * c.med + k * lnB) / (c.n + k) : lnB;
  return { ln: lnC, nCohort: c ? c.n : 0 };
}

// ── per-model accumulation ───────────────────────────────────────────────────
interface Acc { abs: number[]; logs: number[] }
const tiers = ['<500k', '500-750k', '750k-1M', '1-1.5M', '1.5-2M', '2M+'];
function fmt(abs: number[], logs: number[]): string {
  const hit = (t: number) => ((abs.filter((x) => x <= t).length / abs.length) * 100).toFixed(1);
  return `med ${(median(abs) * 100).toFixed(2)}%  MAPE ${(mean(abs) * 100).toFixed(2)}%  bias ${mean(logs) >= 0 ? '+' : ''}${mean(logs).toFixed(4)}  hit±5/10/20 ${hit(0.05)}/${hit(0.1)}/${hit(0.2)}  n=${abs.length}`;
}

async function main() {
  const evalStart = monthsAgoIso(EVAL_MONTHS);
  const poolStart = monthsAgoIso(EVAL_MONTHS + 18 + 1);
  let raw: Raw[];
  if (!has('--refresh') && fs.existsSync(CACHE)) {
    console.log(`📦 loading pool cache ${CACHE}`);
    raw = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } else {
    console.log(`📥 streaming raw_vow_sold (purchase_contract_date >= ${poolStart})…`);
    raw = await streamPool(poolStart);
    try { fs.writeFileSync(CACHE, JSON.stringify(raw)); } catch { /* ignore */ }
  }
  console.log(`   pool ${raw.length}`);

  // index
  const pool: Sale[] = [];
  for (const r of raw) {
    const normSub = normalizePropertySubType(r.sub);
    const month = r.ref.slice(0, 7);
    let lnr: number | null = null;
    if (r.close > 0 && r.list > 0) { const rr = r.close / r.list; if (rr >= R_MIN && rr <= R_MAX) lnr = Math.log(rr); }
    const s: Sale = { ...r, month, normSub, lnr };
    pool.push(s);
    if (lnr !== null && normSub) {
      const cityLower = r.city.trim().toLowerCase();
      const crTrim = r.cr.trim();
      if (crTrim && r.sub) push(cohortB, `${crTrim}␟${r.sub}`, month, lnr);
      if (cityLower) { push(cityB, `${cityLower}␟${normSub}`, month, lnr); push(cityAllB, cityLower, month, lnr); }
      push(subB, normSub, month, lnr);
    }
  }
  let evalSales = pool.filter((s) => s.ref >= evalStart && s.normSub && s.cr.trim() && s.lnr !== null && s.close > 0 && s.list > 0)
    .sort((a, b) => (a.ref < b.ref ? 1 : -1));
  if (evalSales.length > LIMIT) evalSales = evalSales.slice(0, LIMIT);
  console.log(`🎯 evaluating ${evalSales.length} held-out sales\n`);

  // ── model predictors (return predicted close) ──────────────────────────────
  type Cfg = { name: string; predict: (s: Sale) => number; nCohort?: (s: Sale) => number };
  const cohortKeysOf = (s: Sale) => {
    const ks: string[] = [];
    for (const cand of cityRegionLookupCandidates(s.cr.trim())) for (const v of rawVariantsOf(s.normSub, s.sub)) ks.push(`${cand}␟${v}`);
    return ks;
  };
  const liveAnalog = (s: Sale, win: number): number => {
    // mirror getCloseListRatio: city×sub median over trailing `win` months (strictly earlier),
    // fallback to city-all-types if < 12 samples; else R=1.
    const months = monthsBackList(s.month, win);
    const cityKey = `${s.city.trim().toLowerCase()}␟${s.normSub}`;
    const coh = wmed(cityB, [cityKey], months, `LV␟${cityKey}␟${s.month}|${win}`);
    if (coh && coh.n >= 12) return s.list * Math.exp(coh.med);
    const all = wmed(cityAllB, [s.city.trim().toLowerCase()], months, `LVA␟${s.city.trim().toLowerCase()}␟${s.month}|${win}`);
    if (all && all.n >= 12) return s.list * Math.exp(all.med);
    return s.list;
  };
  const m1 = (s: Sale): number => {
    const a = wmed(subB, [s.normSub], monthsBackList(s.month, GLOBAL_MO), `M1␟${s.normSub}␟${s.month}`);
    return s.list * Math.exp(a ? a.med : 0);
  };
  const m2 = (s: Sale, win: number, k: number): number => {
    const r = shrunk(s.month, win, k, cohortKeysOf(s), `${s.cr}|${s.normSub}|${s.sub}`, `${s.city.trim().toLowerCase()}␟${s.normSub}`, s.normSub);
    return s.list * Math.exp(r.ln);
  };
  const m3 = (s: Sale, win: number, k: number, recent: number, k3: number): number => {
    const cohortKeys = cohortKeysOf(s);
    const cityKey = `${s.city.trim().toLowerCase()}␟${s.normSub}`;
    const base = shrunk(s.month, win, k, cohortKeys, `${s.cr}|${s.normSub}|${s.sub}`, cityKey, s.normSub);
    const rec = shrunk(s.month, recent, k, cohortKeys, `${s.cr}|${s.normSub}|${s.sub}`, cityKey, s.normSub);
    const ln = (rec.nCohort * rec.ln + k3 * base.ln) / (rec.nCohort + k3);
    return s.list * Math.exp(ln);
  };

  const configs: Cfg[] = [
    { name: 'LIVE  city×sub 6mo (prod getCloseListRatio)', predict: (s) => liveAnalog(s, 6) },
    { name: 'LIVE  city×sub 12mo', predict: (s) => liveAnalog(s, 12) },
    { name: 'M1    sub-type market 6mo', predict: m1 },
    { name: 'M2    k12 w12', predict: (s) => m2(s, 12, 12) },
    { name: 'M2    k6  w12', predict: (s) => m2(s, 12, 6) },
    { name: 'M2    k24 w12', predict: (s) => m2(s, 12, 24) },
    { name: 'M2    k12 w9 ', predict: (s) => m2(s, 9, 12) },
    { name: 'M2    k12 w18', predict: (s) => m2(s, 18, 12) },
    { name: 'M3    k12 w12 r4 k3=8', predict: (s) => m3(s, 12, 12, 4, 8) },
    { name: 'M3    k12 w12 r3 k3=8', predict: (s) => m3(s, 12, 12, 3, 8) },
    { name: 'M3    k12 w12 r6 k3=12', predict: (s) => m3(s, 12, 12, 6, 12) },
    { name: 'M3    k24 w12 r4 k3=8', predict: (s) => m3(s, 12, 24, 4, 8) },
    { name: 'M3    k12 w9  r3 k3=8', predict: (s) => m3(s, 9, 12, 3, 8) },
  ];

  console.log('════════ model comparison (all held-out sales) ════════');
  const results: { cfg: Cfg; abs: number[]; logs: number[]; byTier: Map<string, number[]> }[] = [];
  for (const cfg of configs) {
    const abs: number[] = [], logs: number[] = [];
    const byTier = new Map<string, number[]>();
    for (const s of evalSales) {
      const pred = cfg.predict(s);
      if (!(pred > 0)) continue;
      const a = Math.abs(pred - s.close) / s.close;
      abs.push(a); logs.push(Math.log(pred) - Math.log(s.close));
      const t = priceTier(s.close); const arr = byTier.get(t) || []; arr.push(a); byTier.set(t, arr);
    }
    results.push({ cfg, abs, logs, byTier });
    console.log(`  ${cfg.name.padEnd(40)} ${fmt(abs, logs)}`);
  }

  // pick winner by MAPE (mean abs) — robust to tails, what users feel
  const winner = [...results].sort((a, b) => mean(a.abs) - mean(b.abs))[0];
  console.log(`\n🏆 best by MAPE: ${winner.cfg.name.trim()}`);
  console.log('\n──── winner by price tier (median |%err|, n) ────');
  for (const t of tiers) { const v = winner.byTier.get(t); if (v) console.log(`  ${t.padEnd(9)} ${(median(v) * 100).toFixed(2)}%   n=${v.length}`); }

  // also compare winner vs LIVE-6mo by tier (does upgrading help, and where?)
  const live = results.find((r) => r.cfg.name.startsWith('LIVE  city×sub 6mo'))!;
  console.log('\n──── LIVE-6mo vs winner, median |%err| by tier ────');
  for (const t of tiers) {
    const lv = live.byTier.get(t), wn = winner.byTier.get(t);
    if (lv && wn) console.log(`  ${t.padEnd(9)} live ${(median(lv) * 100).toFixed(2)}%  → winner ${(median(wn) * 100).toFixed(2)}%`);
  }

  // ── band calibration on the winner: half-width h s.t. coverage ≈ 0.68 ───────
  console.log('\n════════ band calibration (winner) ════════');
  const ratioErr = evalSales.map((s) => { const p = winner.cfg.predict(s); return p > 0 ? s.close / p : NaN; }).filter((x) => Number.isFinite(x));
  const coverage = (h: number) => ratioErr.filter((r) => r >= 1 - h && r <= 1 + h).length / ratioErr.length;
  for (const h of [0.03, 0.04, 0.05, 0.06, 0.08]) console.log(`  ±${(h * 100).toFixed(0)}%  coverage ${(coverage(h) * 100).toFixed(1)}%`);
  // solve for 0.68
  let lo = 0.01, hi = 0.4;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (coverage(mid) < 0.68) lo = mid; else hi = mid; }
  console.log(`  → half-width for 68% coverage: ±${(((lo + hi) / 2) * 100).toFixed(1)}%`);
  // by cohort support tier (using M2/M3 cohort n where available)
  console.log('\n──── coverage of a ±4% band, by cohort support ────');
  const buckets = new Map<string, number[]>();
  for (const s of evalSales) {
    const p = winner.cfg.predict(s); if (!(p > 0)) continue;
    const r = s.close / p;
    const ck = cohortKeysOf(s);
    const c = wmed(cohortB, ck, monthsBackList(s.month, 12), `WC␟${s.cr}|${s.normSub}|${s.sub}␟${s.month}|12`);
    const n = c ? c.n : 0;
    const tier = n >= 50 ? 'cohort n≥50' : n >= 12 ? 'cohort 12–49' : 'thin (<12)';
    const arr = buckets.get(tier) || []; arr.push(r >= 0.96 && r <= 1.04 ? 1 : 0); buckets.set(tier, arr);
  }
  for (const [k, v] of [...buckets.entries()].sort()) console.log(`  ${k.padEnd(14)} ${(mean(v) * 100).toFixed(1)}%   n=${v.length}`);

  console.log('\n✅ Done.');
}
main().catch((e) => { console.error('CRASH:', e?.message || e); process.exit(1); });
