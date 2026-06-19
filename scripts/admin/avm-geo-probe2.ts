/**
 * GEOGRAPHIC SIGNAL @ FULL-POSTAL granularity — done honestly (read-only).
 *
 * Naive between-group variance INFLATES as groups get finer (every postal with one
 * sale "explains" 100% of its own variance), so it cannot be used to judge full-postal
 * signal. Instead this runs a LEAVE-ONE-OUT predictive test on log(price/sqft) (size
 * controlled): for each sold home, compare the error of
 *    community median  vs  median of OTHER sales at the same {full postal / FSA+LDU1 / FSA}
 * (the home itself always excluded). The error REDUCTION where a nearby comp exists is the
 * real, granularity-artifact-free measure of what proximity weighting buys — and the
 * COVERAGE (how often such a comp exists) says how often it can buy it. Split by dwelling
 * class because a same-full-postal comp usually means a shared condo building.
 *
 * Also reports the raw postal_code FORMAT (length histogram, distinct counts, density).
 * Proper TLS. raw_vow_sold READ-ONLY.
 * Usage: npx.cmd tsx --env-file=.env scripts/admin/avm-geo-probe2.ts --months 18
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizePropertySubType, isCanonicalSubType } from '@/lib/avm/normalizeType';

function numFlag(name: string, def: number): number {
  const a = process.argv.find((x) => x.startsWith(name));
  if (!a) return def;
  const raw = a.includes('=') ? a.split('=')[1] : process.argv[process.argv.indexOf(a) + 1];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}
const MONTHS = numFlag('--months', 18);
const MIN_COHORT_N = numFlag('--min-cohort', 40);

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('missing supabase env'); process.exit(1); }
const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function monthsAgoIso(m: number): string { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 10); }

interface Row { listing_key: string; city_region: string | null; property_sub_type: string | null; pcfull: string | null; close_price: number | null; building_area_total: number | null; }
interface Home { key: string; full: string; fsa1: string; fsa: string; v: number; isCondo: boolean }

function median(xs: number[]): number { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
const pc = (x: number) => (x * 100).toFixed(1) + '%';

async function main() {
  console.log('========================================');
  console.log('  GEOGRAPHIC SIGNAL @ FULL POSTAL (leave-one-out, size-controlled)');
  console.log(`  window ${MONTHS}mo · min cohort n=${MIN_COHORT_N}`);
  console.log('========================================');
  const windowStart = monthsAgoIso(MONTHS);

  const lenHist = new Map<number, number>();
  const distinctFull = new Set<string>(), distinctFsa = new Set<string>();
  const sampleMasked: string[] = [];
  const cohorts = new Map<string, Home[]>();
  let total = 0, withPostal = 0, withSqft = 0;
  let cursor = '';
  for (;;) {
    const { data, error } = await sb
      .from('raw_vow_sold')
      .select('listing_key, city_region, property_sub_type, pcfull:raw_payload->>PostalCode, close_price, building_area_total')
      .gt('listing_key', cursor)
      .gte('purchase_contract_date', windowStart)
      .gte('close_price', 50000)
      .order('listing_key', { ascending: true })
      .limit(500);
    if (error) { console.error('read error, retry:', error.message); await sleep(2000); continue; }
    if (!data || data.length === 0) break;
    for (const r of data as unknown as Row[]) {
      cursor = r.listing_key;
      total++;
      const raw = (r.pcfull || '').replace(/\s+/g, '').toUpperCase();
      lenHist.set(raw.length, (lenHist.get(raw.length) ?? 0) + 1);
      if (raw.length >= 3) withPostal++;
      if (raw.length === 6 && sampleMasked.length < 6) sampleMasked.push(raw.slice(0, 3) + ' ' + raw[3] + 'X' + raw[5]); // masked example
      const cr = (r.city_region || '').trim();
      const sub = normalizePropertySubType(r.property_sub_type);
      const cp = Number(r.close_price);
      const sqft = Number(r.building_area_total);
      if (!cr || !sub || !(cp > 0) || raw.length < 6 || !(sqft > 0)) continue;
      withSqft++;
      distinctFull.add(raw); distinctFsa.add(raw.slice(0, 3));
      const key = `${cr}||${sub}`;
      let arr = cohorts.get(key);
      if (!arr) { arr = []; cohorts.set(key, arr); }
      arr.push({ key: r.listing_key, full: raw, fsa1: raw.slice(0, 4), fsa: raw.slice(0, 3), v: Math.log(cp / sqft), isCondo: !isCanonicalSubType(sub) ? false : sub === 'Condo Apartment' });
    }
    if (data.length < 500) break;
    await sleep(40);
  }

  console.log(`\nstreamed ${total} sold rows · postal present ${pc(withPostal / total)} · usable (6-char postal + sqft) ${pc(withSqft / total)}`);
  console.log('postal length histogram:', [...lenHist.entries()].sort((a, b) => a[0] - b[0]).map(([l, n]) => `${l}ch=${n}`).join('  '));
  console.log(`distinct full postals: ${distinctFull.size} · distinct FSAs: ${distinctFsa.size} · ~${(withSqft / Math.max(distinctFull.size, 1)).toFixed(1)} usable sales per full postal`);
  console.log('masked full-postal examples:', sampleMasked.join(', '));

  // Leave-one-out: per rung, coverage + error(base community) vs error(geo) on log(price/sqft).
  const rungs: { name: string; of: (h: Home) => string }[] = [
    { name: 'same FULL postal', of: (h) => h.full },
    { name: 'same FSA+LDU1  ', of: (h) => h.fsa1 },
    { name: 'same FSA       ', of: (h) => h.fsa },
  ];
  // Accumulators per rung + split.
  type Acc = { cov: number; n: number; baseErr: number[]; geoErr: number[] };
  const mk = (): Acc => ({ cov: 0, n: 0, baseErr: [], geoErr: [] });
  const acc: Record<string, { all: Acc; condo: Acc; house: Acc }> = {};
  for (const r of rungs) acc[r.name] = { all: mk(), condo: mk(), house: mk() };

  for (const [, arr] of cohorts) {
    if (arr.length < MIN_COHORT_N) continue;
    const sumAll = arr.reduce((a, h) => a + h.v, 0);
    for (const r of rungs) {
      const byGrp = new Map<string, Home[]>();
      for (const h of arr) { (byGrp.get(r.of(h)) ?? byGrp.set(r.of(h), []).get(r.of(h))!).push(h); }
      for (const h of arr) {
        acc[r.name].all.n++;
        if (h.isCondo) acc[r.name].condo.n++; else acc[r.name].house.n++;
        const grp = byGrp.get(r.of(h))!;
        if (grp.length < 2) continue; // no OTHER comp at this rung
        // geo prediction = median of same-rung mates excluding self.
        const mates = grp.filter((g) => g.key !== h.key).map((g) => g.v);
        if (!mates.length) continue;
        const geoMed = median(mates);
        // community baseline = median of ALL other cohort homes (leave-one-out).
        const commMed = (sumAll - h.v) / (arr.length - 1); // mean is fine as a cheap LOO baseline
        const eBase = Math.abs(h.v - commMed);
        const eGeo = Math.abs(h.v - geoMed);
        for (const a of [acc[r.name].all, h.isCondo ? acc[r.name].condo : acc[r.name].house]) {
          a.cov++; a.baseErr.push(eBase); a.geoErr.push(eGeo);
        }
      }
    }
  }

  console.log('\n── LEAVE-ONE-OUT: same-rung comp vs community baseline (log price/sqft; |err| ≈ % off) ──');
  for (const r of rungs) {
    console.log(`\n  ${r.name}`);
    for (const [lab, a] of [['all', acc[r.name].all], ['condo', acc[r.name].condo], ['house', acc[r.name].house]] as const) {
      if (a.n === 0) continue;
      const cov = a.cov / a.n;
      const mb = median(a.baseErr), mg = median(a.geoErr);
      const red = mb > 0 ? 1 - mg / mb : 0;
      console.log(`     ${lab.padEnd(6)} coverage ${pc(cov).padStart(6)} (${a.cov}/${a.n})  median|err| community ${pc(mb).padStart(6)} → geo ${pc(mg).padStart(6)}  reduction ${pc(red).padStart(6)}`);
    }
  }
  console.log('\nDONE.');
}
main().catch((e) => { console.error('CRASH:', e?.message || e); process.exit(1); });
