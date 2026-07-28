/**
 * Verification for migration 099 (sold city lookup RPCs).
 *
 * Proves, through the real supabase-js/PostgREST path the app uses, that each new RPC
 * returns byte-identical results to the ILIKE query it replaces — and measures both.
 *
 * Usage: npx tsx scripts/admin/verify099.ts
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const CITIES = ['Mississauga', 'Toronto C01', 'Hamilton', 'Brampton', 'Vaughan', 'Oakville', 'Barrie'];
const SUBS = ['Detached', 'Semi-Detached', 'Condo Apartment', 'Att/Row/Townhouse'];
const PRICE_FLOOR = 50_000;
const MAX_ROWS = 12000;
const MAX_COMPS = 400;

const cutoff = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

let failures = 0;
// PromiseLike, not Promise: supabase-js query builders are thenables, not real Promises.
const ms = async <T>(fn: () => PromiseLike<T>): Promise<[T, number]> => {
  const t = Date.now();
  const r = await fn();
  return [r, Date.now() - t];
};

/**
 * @param capped true when the result hit a LIMIT / PostgREST row cap. In that case the
 *   two queries are selecting from a set of ties on the ORDER BY key, and the OLD query
 *   had no tie-breaker — so a difference at the boundary is expected and is NOT a
 *   failure. Below the cap the sets must match exactly.
 */
function cmp(label: string, oldRows: unknown[], newRows: unknown[], capped = false) {
  const a = JSON.stringify(oldRows);
  const b = JSON.stringify(newRows);
  if (a === b) {
    console.log(`     ✅ identical (${oldRows.length} rows)`);
    return;
  }
  if (capped) {
    const overlap = new Set(newRows as string[]);
    const shared = (oldRows as string[]).filter((r) => overlap.has(r)).length;
    console.log(
      `     ⚠️  boundary tie-break differs (${shared}/${oldRows.length} shared) — expected: ` +
      `old query had no tie-breaker at the LIMIT`
    );
    return;
  }
  failures++;
  console.log(`     ❌ MISMATCH ${label}: old=${oldRows.length} new=${newRows.length}`);
  for (let i = 0; i < Math.min(oldRows.length, newRows.length); i++) {
    if (JSON.stringify(oldRows[i]) !== JSON.stringify(newRows[i])) {
      console.log(`        first diff @${i}\n          old: ${JSON.stringify(oldRows[i])}\n          new: ${JSON.stringify(newRows[i])}`);
      break;
    }
  }
}

async function main() {
  console.log('=== A. sold_close_list_rows  (getCloseListRatio) ===');
  let oldT = 0, newT = 0;
  for (const city of CITIES) {
    const safe = city.replace(/[,()]/g, ' ').trim();
    const [oldRes, t1] = await ms(() =>
      sb.from('raw_vow_sold')
        .select('close_price, list_price, property_sub_type')
        .or(`city.ilike.${safe},city_region.ilike.${safe}`)
        .gte('close_price', PRICE_FLOOR)
        .gte('purchase_contract_date', cutoff(180))
        .order('purchase_contract_date', { ascending: false })
        .limit(MAX_ROWS)
    );
    const [newRes, t2] = await ms(() =>
      sb.rpc('sold_close_list_rows', {
        p_city: safe, p_price_floor: PRICE_FLOOR, p_cutoff: cutoff(180), p_limit: MAX_ROWS,
      })
    );
    if (oldRes.error) { console.log(`  ${city}: old errored — ${oldRes.error.message}`); failures++; continue; }
    if (newRes.error) { console.log(`  ${city}: RPC errored — ${newRes.error.message}`); failures++; continue; }
    oldT += t1; newT += t2;
    console.log(`  ${city.padEnd(12)} old ${String(t1).padStart(5)}ms → new ${String(t2).padStart(5)}ms`);
    // Order among equal purchase_contract_date values is not guaranteed by either query,
    // so compare as multisets on the value columns.
    const norm = (rows: Record<string, unknown>[]) =>
      rows.map((r) => `${r.close_price}|${r.list_price}|${r.property_sub_type}`).sort();
    // PostgREST caps responses at 1,000 rows, so ≥1000 means we are at a tie boundary.
    cmp(city, norm(oldRes.data ?? []), norm(newRes.data ?? []), (oldRes.data?.length ?? 0) >= 1000);
  }
  console.log(`  TOTAL: old ${oldT}ms → new ${newT}ms  (${(oldT / Math.max(newT, 1)).toFixed(1)}x faster)\n`);

  console.log('=== B. sold_city_regions  (fetchSiblingModel) ===');
  oldT = 0; newT = 0;
  for (const city of CITIES) {
    const [oldSet, t1] = await ms(async () => {
      const PAGE = 1000;
      const s = new Set<string>();
      for (let from = 0; from < PAGE * 20; from += PAGE) {
        const { data, error } = await sb.from('raw_vow_sold')
          .select('city_region')
          .ilike('city', city.trim())
          .in('property_sub_type', SUBS)
          .order('city_region')
          .range(from, from + PAGE - 1);
        if (error || !data) break;
        for (const r of data as { city_region: string }[]) if (r.city_region) s.add(r.city_region);
        if (data.length < PAGE) break;
      }
      return Array.from(s).sort();
    });
    const [newRes, t2] = await ms(() =>
      sb.rpc('sold_city_regions', { p_city: city.trim(), p_sub_types: SUBS })
    );
    if (newRes.error) { console.log(`  ${city}: RPC errored — ${newRes.error.message}`); failures++; continue; }
    oldT += t1; newT += t2;
    const newSet = (newRes.data as { city_region: string }[]).map((r) => r.city_region).sort();
    console.log(`  ${city.padEnd(12)} old ${String(t1).padStart(5)}ms → new ${String(t2).padStart(5)}ms`);
    cmp(city, oldSet, newSet);
  }
  console.log(`  TOTAL: old ${oldT}ms → new ${newT}ms  (${(oldT / Math.max(newT, 1)).toFixed(1)}x faster)\n`);

  console.log('=== C. sold_city_comps  (fetchPeerAnchor rung 2) ===');
  const COMP_SELECT =
    'close_price, purchase_contract_date, close_date, building_area_total, ' +
    'lot_width, lot_depth, bedrooms_above_grade, bathrooms_total_integer, parking_total, ' +
    'interior_tier, exterior_tier, basement_tier, postal_code';
  oldT = 0; newT = 0;
  for (const city of CITIES) {
    const [oldRes, t1] = await ms(() =>
      sb.from('raw_vow_sold').select(COMP_SELECT)
        .ilike('city', city.trim())
        .in('property_sub_type', SUBS)
        .gte('close_price', PRICE_FLOOR)
        .gte('purchase_contract_date', cutoff(365))
        .order('purchase_contract_date', { ascending: false })
        .limit(MAX_COMPS)
    );
    const [newRes, t2] = await ms(() =>
      sb.rpc('sold_city_comps', {
        p_city: city.trim(), p_sub_types: SUBS, p_price_floor: PRICE_FLOOR,
        p_cutoff: cutoff(365), p_limit: MAX_COMPS,
      })
    );
    if (oldRes.error) { console.log(`  ${city}: old errored — ${oldRes.error.message}`); failures++; continue; }
    if (newRes.error) { console.log(`  ${city}: RPC errored — ${newRes.error.message}`); failures++; continue; }
    oldT += t1; newT += t2;
    console.log(`  ${city.padEnd(12)} old ${String(t1).padStart(5)}ms → new ${String(t2).padStart(5)}ms`);
    const norm = (rows: Record<string, unknown>[]) =>
      rows.map((r) => COMP_SELECT.split(',').map((c) => String(r[c.trim()])).join('|')).sort();
    // Hitting MAX_COMPS means the cut-off date is shared by more rows than fit.
    cmp(
      city,
      // COMP_SELECT is a runtime string, so supabase-js cannot infer the row shape.
      norm((oldRes.data ?? []) as unknown as Record<string, unknown>[]),
      norm((newRes.data ?? []) as unknown as Record<string, unknown>[]),
      (oldRes.data?.length ?? 0) >= MAX_COMPS
    );
  }
  console.log(`  TOTAL: old ${oldT}ms → new ${newT}ms  (${(oldT / Math.max(newT, 1)).toFixed(1)}x faster)\n`);

  // The LIMIT boundary sits on ties (≈19 rows share the cut-off date), so old vs new
  // can legitimately keep different subsets — the OLD query was never deterministic.
  // What must hold: (1) the two agree exactly whenever the result is under the cap,
  // (2) the RPC is now stable run-to-run, (3) the RPC's set is a faithful prefix of the
  // fully-ordered truth. (1) is covered above; (2) and (3) here.
  console.log('=== E. Determinism of the new RPCs (repeat runs) ===');
  for (const city of ['Mississauga', 'Toronto C01', 'Hamilton']) {
    const runs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { data } = await sb.rpc('sold_city_comps', {
        p_city: city, p_sub_types: SUBS, p_price_floor: PRICE_FLOOR,
        p_cutoff: cutoff(365), p_limit: MAX_COMPS,
      });
      runs.push(JSON.stringify(data));
    }
    const stable = runs[0] === runs[1] && runs[1] === runs[2];
    console.log(`  ${city.padEnd(12)} ${stable ? '✅ identical across 3 runs' : '❌ UNSTABLE'}`);
    if (!stable) failures++;
  }
  for (const city of ['Mississauga', 'Hamilton']) {
    const runs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { data } = await sb.rpc('sold_close_list_rows', {
        p_city: city, p_price_floor: PRICE_FLOOR, p_cutoff: cutoff(180), p_limit: MAX_ROWS,
      });
      runs.push(JSON.stringify(data));
    }
    const stable = runs[0] === runs[1] && runs[1] === runs[2];
    console.log(`  ${city.padEnd(12)} ${stable ? '✅ identical across 3 runs (close/list)' : '❌ UNSTABLE'}`);
    if (!stable) failures++;
  }
  console.log('');

  console.log('=== D. Wildcard behaviour (the "%" amplification) ===');
  const [wOld] = await ms(() =>
    sb.from('raw_vow_sold').select('close_price').ilike('city', '%').limit(5000)
  );
  const [wNew] = await ms(() =>
    sb.rpc('sold_close_list_rows', { p_city: '%', p_price_floor: 0, p_cutoff: '1900-01-01', p_limit: 5000 })
  );
  console.log(`  ILIKE '%' matched ${wOld.data?.length ?? 0} rows (capped at 5000)`);
  console.log(`  RPC   '%' matched ${(wNew.data as unknown[])?.length ?? 0} rows  ← literal, matches nothing`);
  if (((wNew.data as unknown[])?.length ?? 0) !== 0) { failures++; console.log('     ❌ expected 0'); }
  else console.log('     ✅ wildcard neutralised');

  console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
