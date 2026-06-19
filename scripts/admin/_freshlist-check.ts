/**
 * THROWAWAY analysis (delete after): quantify the fresh-listing degradation for the
 * single list-anchored "Estimated Sale Price". The production model anchors on a home's
 * CURRENT list. The expected-sale backtest measures accuracy against each sold home's
 * FINAL list (post-reductions). A freshly-listed active home still showing its ORIGINAL
 * ask is the realistic worst case — this measures close/original_list vs close/final_list
 * so we can set an honest band + caveat. Read-only on raw_vow_sold (§12); writes nothing.
 *
 *   npx.cmd tsx --env-file=.env scripts/admin/_freshlist-check.ts --months 6 --limit 40000
 */
import { createClient } from '@supabase/supabase-js';
import { normalizePropertySubType } from '@/lib/avm/normalizeType';

function num(name: string, def: number): number {
  const a = process.argv.find((x) => x.startsWith(name));
  if (!a) return def;
  const raw = a.includes('=') ? a.split('=')[1] : process.argv[process.argv.indexOf(a) + 1];
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}
const MONTHS = num('--months', 6);
const LIMIT = num('--limit', 40000);
const FLOOR = 50_000;
const R_MIN = 0.3, R_MAX = 3.0;

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

interface Row {
  listing_key: string;
  close_price: number | null;
  list_price: number | null;
  ol: string | null; // raw_payload->>OriginalListPrice
  property_sub_type: string | null;
}

async function main() {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - MONTHS);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  console.log(`Streaming sold since ${cutoffIso} (close>=${FLOOR})…`);

  const rows: Row[] = [];
  let cursor = '';
  for (;;) {
    const { data, error } = await sb
      .from('raw_vow_sold')
      .select('listing_key, close_price, list_price, property_sub_type, ol:raw_payload->>OriginalListPrice')
      .gt('listing_key', cursor)
      .gte('purchase_contract_date', cutoffIso)
      .gte('close_price', FLOOR)
      .order('listing_key', { ascending: true })
      .limit(1000);
    if (error) { console.error(error.message); process.exit(1); }
    if (!data || !data.length) break;
    for (const r of data as unknown as Row[]) { cursor = r.listing_key; rows.push(r); }
    if (rows.length >= LIMIT) break;
    if (data.length < 1000) break;
    await sleep(150);
  }
  console.log(`pooled ${rows.length}`);

  // close/list (final) and close/original_list, per sub-type median ratio, applied in-sample.
  // Two prediction modes per anchor:
  //   R=1  : prediction = anchor (just echo the price)
  //   R=med: prediction = anchor × subtypeMedian(close/anchor)
  type Pair = { close: number; anchor: number; sub: string };
  const finalPairs: Pair[] = [];
  const origPairs: Pair[] = [];
  let olFill = 0, dropCount = 0, sameCount = 0, raiseCount = 0;

  for (const r of rows) {
    const close = Number(r.close_price);
    const list = Number(r.list_price);
    const sub = normalizePropertySubType(r.property_sub_type) || 'UNK';
    if (close > 0 && list > 0) {
      const rr = close / list;
      if (rr >= R_MIN && rr <= R_MAX) finalPairs.push({ close, anchor: list, sub });
    }
    const ol = r.ol != null ? Number(r.ol) : NaN;
    if (Number.isFinite(ol) && ol > 0) {
      olFill++;
      if (list > 0) {
        if (ol > list * 1.001) dropCount++;
        else if (ol < list * 0.999) raiseCount++;
        else sameCount++;
      }
      if (close > 0) {
        const rr = close / ol;
        if (rr >= R_MIN && rr <= R_MAX) origPairs.push({ close, anchor: ol, sub });
      }
    }
  }

  const subMed = (pairs: Pair[]) => {
    const by = new Map<string, number[]>();
    for (const p of pairs) {
      const arr = by.get(p.sub) || [];
      arr.push(p.close / p.anchor);
      by.set(p.sub, arr);
    }
    const med = new Map<string, number>();
    for (const [k, v] of by) med.set(k, median(v));
    return med;
  };

  const evalMode = (pairs: Pair[], useRatio: boolean, label: string) => {
    const med = useRatio ? subMed(pairs) : null;
    const abs: number[] = [];
    for (const p of pairs) {
      const R = useRatio ? med!.get(p.sub) || 1 : 1;
      const pred = p.anchor * R;
      abs.push(Math.abs(pred - p.close) / p.close);
    }
    const hit = (t: number) => ((abs.filter((x) => x <= t).length / abs.length) * 100).toFixed(1);
    console.log(
      `  ${label.padEnd(34)} med ${(median(abs) * 100).toFixed(2)}%  MAPE ${(mean(abs) * 100).toFixed(2)}%  hit±5/10 ${hit(0.05)}/${hit(0.1)}%  n=${abs.length}`
    );
  };

  const olPct = rows.length ? (olFill / rows.length) * 100 : 0;
  const withList = dropCount + sameCount + raiseCount;
  console.log(`\nOriginalListPrice present: ${olPct.toFixed(1)}% of rows`);
  if (withList) {
    console.log(
      `Of those with both: dropped ${((dropCount / withList) * 100).toFixed(1)}%  ·  unchanged ${((sameCount / withList) * 100).toFixed(1)}%  ·  raised ${((raiseCount / withList) * 100).toFixed(1)}%`
    );
  }
  console.log('\n──── Anchor = FINAL list (the backtest / aged-listing case) ────');
  evalMode(finalPairs, false, 'R=1   echo final list');
  evalMode(finalPairs, true, 'R=med subtype close/list');
  console.log('\n──── Anchor = ORIGINAL list (fresh-listing worst case) ────');
  evalMode(origPairs, false, 'R=1   echo original list');
  evalMode(origPairs, true, 'R=med subtype close/orig');
  console.log('\n✅ Done.');
}
main().catch((e) => { console.error('CRASH:', e?.message || e); process.exit(1); });
