/**
 * AVM DATA AVAILABILITY AUDIT (read-only, no DB writes).
 *
 * Answers the foundational question for AVM accuracy: which features actually
 * EXIST in raw_vow_sold, and at what coverage? A feature that is mostly null is
 * mean-imputed (z=0) by the model, so a big/small home is silently priced at the
 * neighbourhood average — the single most likely cause of "my home shows so low".
 *
 * Streams a bounded sample over Supabase REST (same transport as avm-backtest.ts),
 * prints the column list once, then null/zero coverage + crude stats per feature,
 * plus close_price tier distribution. Nothing is written.
 *
 * Usage: npx.cmd tsx --env-file=.env scripts/admin/avm-data-audit.ts --sample 60000
 */
// Proper TLS verification (Supabase serves valid certs). No weakening.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function numFlag(name: string, def: number): number {
  const a = process.argv.find((x) => x.startsWith(name));
  if (!a) return def;
  const raw = a.includes('=') ? a.split('=')[1] : process.argv[process.argv.indexOf(a) + 1];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}
const SAMPLE = numFlag('--sample', 60000);
const MONTHS = numFlag('--months', 24);

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

// Numeric feature columns we care about for the AVM.
const NUM_COLS = [
  'close_price',
  'building_area_total',
  'lot_width',
  'lot_depth',
  'bedrooms_above_grade',
  'bathrooms_total_integer',
  'parking_total',
  'interior_tier',
  'exterior_tier',
  'basement_tier',
];

interface Acc {
  n: number;
  nullCount: number;
  zeroCount: number;
  posCount: number;
  sum: number;
  vals: number[]; // reservoir-ish: keep up to 5000 positive values for percentiles
}
function newAcc(): Acc {
  return { n: 0, nullCount: 0, zeroCount: 0, posCount: 0, sum: 0, vals: [] };
}
function obs(a: Acc, v: unknown) {
  a.n++;
  if (v === null || v === undefined || v === '') {
    a.nullCount++;
    return;
  }
  const num = Number(v);
  if (!Number.isFinite(num)) {
    a.nullCount++;
    return;
  }
  if (num === 0) a.zeroCount++;
  else if (num > 0) {
    a.posCount++;
    a.sum += num;
    if (a.vals.length < 5000) a.vals.push(num);
  }
}
function pctl(vals: number[], p: number): number {
  if (vals.length === 0) return NaN;
  const s = [...vals].sort((x, y) => x - y);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}
function pc(x: number, n: number): string {
  return n === 0 ? 'n/a' : ((x / n) * 100).toFixed(1) + '%';
}

async function main() {
  console.log('========================================');
  console.log('  AVM DATA AVAILABILITY AUDIT (raw_vow_sold)');
  console.log(`  sample target: ${SAMPLE}  ·  window: last ${MONTHS} mo (sold)`);
  console.log('========================================');

  const windowStart = monthsAgoIso(MONTHS);

  // 1) Discover columns from one row.
  const { data: oneRow, error: oneErr } = await sb
    .from('raw_vow_sold')
    .select('*')
    .gte('close_price', 50000)
    .limit(1);
  if (oneErr) {
    console.error('column discovery failed:', oneErr.message);
    process.exit(1);
  }
  const cols = oneRow && oneRow[0] ? Object.keys(oneRow[0]) : [];
  console.log(`\n── raw_vow_sold columns (${cols.length}) ──`);
  console.log(cols.join(', '));

  // Flag presence of geo / age / range columns by fuzzy match.
  const find = (re: RegExp) => cols.filter((c) => re.test(c.toLowerCase()));
  console.log('\n── columns of interest (fuzzy) ──');
  console.log('  lat/long   :', find(/lat|long|lng|geo|coord|point/).join(', ') || 'NONE');
  console.log('  year/age   :', find(/year|built|age|approx/).join(', ') || 'NONE');
  console.log('  living/area:', find(/living|area|sqft|sq_ft|gla|range/).join(', ') || 'NONE');
  console.log('  fee/maint  :', find(/fee|maint|condo|assoc/).join(', ') || 'NONE');
  console.log('  exposure   :', find(/expos|direction|facing|view|balcon/).join(', ') || 'NONE');
  console.log('  storeys/lvl:', find(/storey|stor|level|floor|unit/).join(', ') || 'NONE');
  console.log('  style/type :', find(/style|type|kind|class/).join(', ') || 'NONE');

  // 2) Stream a bounded sample, accumulate coverage stats.
  const accs = new Map<string, Acc>(NUM_COLS.map((c) => [c, newAcc()]));
  const tierDist: Record<string, number> = { '<500k': 0, '500k-1M': 0, '1M-1.5M': 0, '1.5M-2M': 0, '2M+': 0 };
  // subtype distribution (top types)
  const subDist = new Map<string, number>();
  // joint: building_area_total present AND row is a detached/semi/town house?
  let sqftPresentByHouse = 0, houseRows = 0, sqftPresentByCondo = 0, condoRows = 0;

  const PAGE = 1000;
  let cursor = '';
  let total = 0;
  const sel2 = ['listing_key', ...NUM_COLS, 'property_sub_type'].join(', ');
  for (;;) {
    const { data, error } = await sb
      .from('raw_vow_sold')
      .select(sel2)
      .gt('listing_key', cursor)
      .gte('purchase_contract_date', windowStart)
      .gte('close_price', 50000)
      .order('listing_key', { ascending: true })
      .limit(PAGE);
    if (error) {
      console.error('page read failed:', error.message, '— retrying');
      await sleep(2000);
      continue;
    }
    if (!data || data.length === 0) break;
    for (const r of data as unknown as Array<Record<string, unknown>>) {
      cursor = String(r['listing_key']);
      total++;
      for (const c of NUM_COLS) obs(accs.get(c)!, r[c]);
      const cp = Number(r['close_price']);
      if (Number.isFinite(cp) && cp > 0) {
        const t = cp < 500000 ? '<500k' : cp < 1000000 ? '500k-1M' : cp < 1500000 ? '1M-1.5M' : cp < 2000000 ? '1.5M-2M' : '2M+';
        tierDist[t]++;
      }
      const sub = String(r['property_sub_type'] ?? '').trim();
      subDist.set(sub, (subDist.get(sub) ?? 0) + 1);
      const subL = sub.toLowerCase();
      const isCondo = subL.includes('condo') || subL.includes('apartment');
      const isHouse = subL.includes('detached') || subL.includes('semi') || subL.includes('town') || subL.includes('att') || subL.includes('link');
      const sqftPresent = r['building_area_total'] !== null && r['building_area_total'] !== undefined && Number(r['building_area_total']) > 0;
      if (isHouse) { houseRows++; if (sqftPresent) sqftPresentByHouse++; }
      if (isCondo) { condoRows++; if (sqftPresent) sqftPresentByCondo++; }
    }
    if (total >= SAMPLE) break;
    if (data.length < PAGE) break;
    if (total % 10000 === 0) console.log(`   …sampled ${total}`);
    await sleep(60);
  }

  console.log(`\n── coverage over ${total} sampled sold rows ──`);
  console.log('feature'.padEnd(26), 'null%'.padStart(8), 'zero%'.padStart(8), 'pos%'.padStart(8), 'p10'.padStart(10), 'p50'.padStart(10), 'p90'.padStart(10));
  for (const c of NUM_COLS) {
    const a = accs.get(c)!;
    console.log(
      c.padEnd(26),
      pc(a.nullCount, a.n).padStart(8),
      pc(a.zeroCount, a.n).padStart(8),
      pc(a.posCount, a.n).padStart(8),
      String(Math.round(pctl(a.vals, 10))).padStart(10),
      String(Math.round(pctl(a.vals, 50))).padStart(10),
      String(Math.round(pctl(a.vals, 90))).padStart(10),
    );
  }

  console.log('\n── close_price tier distribution ──');
  for (const [t, n] of Object.entries(tierDist)) console.log(`   ${t.padEnd(10)} ${n}  (${pc(n, total)})`);

  console.log('\n── sqft (building_area_total) presence by property class ──');
  console.log(`   houses  : ${sqftPresentByHouse}/${houseRows} present  (${pc(sqftPresentByHouse, houseRows)})`);
  console.log(`   condos  : ${sqftPresentByCondo}/${condoRows} present  (${pc(sqftPresentByCondo, condoRows)})`);

  console.log('\n── top property_sub_type ──');
  const top = [...subDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  for (const [s, n] of top) console.log(`   ${(s || '(blank)').padEnd(28)} ${n}  (${pc(n, total)})`);

  console.log('\nDONE.');
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
