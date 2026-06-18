/**
 * GEOGRAPHIC OPPORTUNITY PROBE (read-only, no DB writes).
 *
 * Geographic comp weighting can only help if homes in the SAME (city_region × sub_type)
 * comp pool — which the AVM today weights only by recency × feature similarity — actually
 * differ in price by WHERE they are inside that community. This quantifies exactly that:
 * for each cohort, decompose the within-cohort dispersion of log(price) and log(price/sqft)
 * into BETWEEN-FSA (postal first-3 = a sub-neighbourhood) vs WITHIN-FSA variance.
 *
 *   geoR2 = between-FSA SS / total SS  = the share of within-community price variation that
 *           is geographic at the FSA level — the HEADROOM a proximity kernel could exploit.
 *
 * Also reports postal_code coverage and, per cohort, the spread between the cheapest and
 * priciest FSA (a tangible "same community, same type, different pocket → X% apart").
 *
 * Proper TLS. raw_vow_sold READ-ONLY.
 * Usage: npx.cmd tsx --env-file=.env scripts/admin/avm-geo-probe.ts --months 18
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizePropertySubType } from '@/lib/avm/normalizeType';

function numFlag(name: string, def: number): number {
  const a = process.argv.find((x) => x.startsWith(name));
  if (!a) return def;
  const raw = a.includes('=') ? a.split('=')[1] : process.argv[process.argv.indexOf(a) + 1];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}
const MONTHS = numFlag('--months', 18);
const MIN_COHORT_N = numFlag('--min-cohort', 40);
const MIN_FSA_N = numFlag('--min-fsa', 5);

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('missing supabase env'); process.exit(1); }
const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function monthsAgoIso(m: number): string { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 10); }

interface Row { listing_key: string; city_region: string | null; property_sub_type: string | null; postal_code: string | null; close_price: number | null; building_area_total: number | null; }

function median(xs: number[]): number { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pc = (x: number) => (x * 100).toFixed(1) + '%';

/** between-group SS / total SS for grouped values (one-way ANOVA R²). */
function geoR2(groups: number[][]): { r2: number; nEffGroups: number; spreadPct: number } | null {
  const all = groups.flat();
  if (all.length < 2) return null;
  const grand = meanOf(all);
  const totalSS = all.reduce((a, v) => a + (v - grand) ** 2, 0);
  if (!(totalSS > 0)) return null;
  let betweenSS = 0;
  const groupMeans: number[] = [];
  for (const g of groups) { const m = meanOf(g); groupMeans.push(m); betweenSS += g.length * (m - grand) ** 2; }
  // spread between priciest and cheapest FSA mean, in % price terms (exp of log-mean gap).
  const spreadPct = Math.exp(Math.max(...groupMeans) - Math.min(...groupMeans)) - 1;
  return { r2: betweenSS / totalSS, nEffGroups: groups.length, spreadPct };
}

async function main() {
  console.log('========================================');
  console.log('  AVM GEOGRAPHIC OPPORTUNITY PROBE');
  console.log(`  window ${MONTHS}mo · min cohort n=${MIN_COHORT_N} · min FSA n=${MIN_FSA_N}`);
  console.log('========================================');

  const windowStart = monthsAgoIso(MONTHS);
  const cohorts = new Map<string, { logP: { fsa: string; v: number }[]; logPpsf: { fsa: string; v: number }[] }>();
  let total = 0, postalNull = 0, sqftPresent = 0;
  let cursor = '';
  for (;;) {
    const { data, error } = await sb
      .from('raw_vow_sold')
      .select('listing_key, city_region, property_sub_type, postal_code, close_price, building_area_total')
      .gt('listing_key', cursor)
      .gte('purchase_contract_date', windowStart)
      .gte('close_price', 50000)
      .order('listing_key', { ascending: true })
      .limit(1000);
    if (error) { console.error('read error, retry:', error.message); await sleep(2000); continue; }
    if (!data || data.length === 0) break;
    for (const r of data as unknown as Row[]) {
      cursor = r.listing_key;
      total++;
      const cr = (r.city_region || '').trim();
      const sub = normalizePropertySubType(r.property_sub_type);
      const cp = Number(r.close_price);
      if (!cr || !sub || !(cp > 0)) continue;
      const pc6 = (r.postal_code || '').replace(/\s+/g, '').toUpperCase();
      if (pc6.length < 3) { postalNull++; continue; }
      const fsa = pc6.slice(0, 3);
      const key = `${cr}||${sub}`;
      let c = cohorts.get(key);
      if (!c) { c = { logP: [], logPpsf: [] }; cohorts.set(key, c); }
      c.logP.push({ fsa, v: Math.log(cp) });
      const sqft = Number(r.building_area_total);
      if (sqft > 0) { sqftPresent++; c.logPpsf.push({ fsa, v: Math.log(cp / sqft) }); }
    }
    if (data.length < 1000) break;
    await sleep(40);
  }
  console.log(`\nstreamed ${total} sold rows · postal missing ${pc(postalNull / total)} · sqft present ${pc(sqftPresent / total)}`);

  // Per-cohort geoR2 on log(price) and log(price/sqft).
  function analyze(pick: (c: { logP: { fsa: string; v: number }[]; logPpsf: { fsa: string; v: number }[] }) => { fsa: string; v: number }[], label: string) {
    const r2s: { r2: number; n: number; spread: number; key: string }[] = [];
    for (const [key, c] of cohorts.entries()) {
      const rows = pick(c);
      if (rows.length < MIN_COHORT_N) continue;
      const byFsa = new Map<string, number[]>();
      for (const r of rows) { (byFsa.get(r.fsa) ?? byFsa.set(r.fsa, []).get(r.fsa)!).push(r.v); }
      const groups = [...byFsa.values()].filter((g) => g.length >= MIN_FSA_N);
      if (groups.length < 2) continue;
      const res = geoR2(groups);
      if (!res) continue;
      r2s.push({ r2: res.r2, n: rows.length, spread: res.spreadPct, key });
    }
    if (!r2s.length) { console.log(`\n${label}: no qualifying cohorts`); return; }
    const totN = r2s.reduce((a, r) => a + r.n, 0);
    const wMean = r2s.reduce((a, r) => a + r.r2 * r.n, 0) / totN;
    const med = median(r2s.map((r) => r.r2));
    const medSpread = median(r2s.map((r) => r.spread));
    console.log(`\n── ${label} (${r2s.length} qualifying cohorts, ${totN} sales) ──`);
    console.log(`   geoR2 (between-FSA share of within-cohort variance): n-weighted ${pc(wMean)} · median ${pc(med)}`);
    console.log(`   median cheapest→priciest FSA spread within a cohort: ${pc(medSpread)}`);
    const top = r2s.filter((r) => r.n >= 80).sort((a, b) => b.r2 - a.r2).slice(0, 8);
    console.log(`   highest-geo cohorts (n≥80):`);
    for (const t of top) console.log(`     ${t.key.padEnd(40)} geoR2 ${pc(t.r2).padStart(6)}  FSA-spread ${pc(t.spread).padStart(6)}  n=${t.n}`);
  }
  analyze((c) => c.logP, 'log(price)  [size NOT controlled]');
  analyze((c) => c.logPpsf, 'log(price / sqft)  [size controlled — the cleaner location signal]');

  console.log('\nDONE.');
}
main().catch((e) => { console.error('CRASH:', e?.message || e); process.exit(1); });
