/**
 * READ-ONLY probe #4. The 1.6x suite multiplier in rentAVM.ts:148.
 *
 * Every listing with a below-grade kitchen is EXISTING_MULTI_UNIT, so its ladder rent
 * is multiplied by 1.6 before it becomes annual_revenue -> gross_yield_est ->
 * cap_rate_est -> the sandbox's "Monthly Rent - Neighbourhood comps".
 *
 * Two questions:
 *   1. What does 1.6x stand in for, and how close is it to real suite economics?
 *   2. The ladder cohorts also contain in-home unit leases (12% of the book), which
 *      drags the whole-home comp DOWN. Does 1.6 accidentally cancel that?
 *
 * Compares, per suite-candidate listing:
 *   today     = contaminated whole-home comp x 1.6
 *   proposed  = CLEAN whole-home comp + real suite comp
 *
 * Usage: npx tsx scripts/admin/_probeSuiteMultiplier.ts
 */
import 'dotenv/config';
import { Client } from 'pg';
import { bedSplit } from '../../src/lib/listings/bedSplit';

const PARTIAL_UNIT_RE = new RegExp(
  [
    /\b(?:bsmn?t|basement|walk\s*-?\s*out)\b/.source,
    /#\s*(?:bsmn?t|basement)/.source,
    /\([^)]*\b(?:lower|upper|main|bsmn?t|basement)\b[^)]*\)/.source,
    /-\s*(?:lower|upper|main)\b/.source,
    /\b(?:lower|upper|main)\s+(?:level|floor|unit|apt|apartment|suite)\b/.source,
    /\b(?:lower|upper|main)\s*(?:$|,)/.source,
  ].join('|'),
  'i'
);
const IN_HOME_SUBTYPES = new Set(['lower level', 'upper level']);
const isPartial = (a?: string | null, s?: string | null) =>
  (!!s && IN_HOME_SUBTYPES.has(s.trim().toLowerCase())) || (!!a && PARTIAL_UNIT_RE.test(a));

const MIN_N = 3;
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pctile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

type Bag = Map<string, number[]>;
const push = (m: Bag, k: string, v: number) => {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
};
const finish = (m: Bag) =>
  new Map([...m].filter(([, v]) => v.length >= MIN_N).map(([k, v]) => [k, med(v)]));

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  const { rows: leases } = await client.query(
    `SELECT list_price, city, city_region,
            btrim(coalesce(property_sub_type,'')) AS sub_type,
            full_payload->>'UnparsedAddress'      AS address,
            full_payload->>'BedroomsTotal'        AS bt,
            full_payload->>'BedroomsAboveGrade'   AS ba,
            full_payload->>'BedroomsBelowGrade'   AS bb,
            full_payload->>'BathroomsTotalInteger' AS bath
       FROM listings
      WHERE lower(coalesce(full_payload->>'TransactionType','')) ~ '(leas|rent)'
        AND list_price BETWEEN 500 AND 25000`
  );

  const num = (v: string | null) => (/^[0-9]+$/.test(v ?? '') ? parseInt(v as string, 10) : null);
  const splitOf = (r: Record<string, string | null>) =>
    bedSplit({ BedroomsTotal: num(r.bt), BedroomsAboveGrade: num(r.ba), BedroomsBelowGrade: num(r.bb) });

  // Whole-home cohorts, built twice: as production does it (mixed) and cleaned.
  const mixed: Bag = new Map();
  const clean: Bag = new Map();
  // Suite cohorts, from the in-home leases only.
  const suiteN: Bag = new Map();
  const suiteC: Bag = new Map();

  for (const r of leases) {
    const rent = Number(r.list_price);
    const s = splitOf(r);
    const part = isPartial(r.address, r.sub_type);
    const cr = (r.city_region ?? '').trim().toLowerCase();
    const ct = (r.city ?? '').trim().toLowerCase();
    const st = (r.sub_type ?? '').trim().toLowerCase();
    const bath = num(r.bath);

    if (part) {
      const beds = Math.min(3, num(r.bt) ?? 1);
      if (cr) push(suiteN, `${cr}|${beds}`, rent);
      if (ct) push(suiteC, `${ct}|${beds}`, rent);
    }
    if (!s || !st) continue;
    const tag = `${s.above}_${s.den}`;
    const keys = [
      cr && bath != null ? `n|${cr}|${st}|${tag}|${bath}` : null,
      ct && bath != null ? `b|${ct}|${st}|${tag}|${bath}` : null,
      ct ? `c|${ct}|${st}|${tag}` : null,
      // main-unit proxy: same above-grade beds, no plus-room
      ct ? `m|${ct}|${st}|${s.above}_0` : null,
    ].filter(Boolean) as string[];
    for (const k of keys) {
      push(mixed, k, rent);
      if (!part) push(clean, k, rent);
    }
  }

  const M = finish(mixed);
  const C = finish(clean);
  const SN = finish(suiteN);
  const SC = finish(suiteC);

  const { rows: cand } = await client.query(
    `SELECT list_price, city, city_region,
            btrim(coalesce(property_sub_type,'')) AS sub_type,
            full_payload->>'BedroomsTotal'         AS bt,
            full_payload->>'BedroomsAboveGrade'    AS ba,
            full_payload->>'BedroomsBelowGrade'    AS bb,
            full_payload->>'BathroomsTotalInteger' AS bath
       FROM listings
      WHERE lower(coalesce(full_payload->>'TransactionType','')) ~ 'sale'
        AND coalesce(full_payload->>'KitchensBelowGrade','0') ~ '^[1-9]'
        AND list_price > 50000`
  );

  const lookup = (bag: Map<string, number>, r: Record<string, string | null>) => {
    const s = splitOf(r);
    if (!s) return null;
    const cr = (r.city_region ?? '').trim().toLowerCase();
    const ct = (r.city ?? '').trim().toLowerCase();
    const st = (r.sub_type ?? '').trim().toLowerCase();
    const bath = num(r.bath);
    const tag = `${s.above}_${s.den}`;
    return (
      (cr && bath != null ? bag.get(`n|${cr}|${st}|${tag}|${bath}`) : undefined) ??
      (ct && bath != null ? bag.get(`b|${ct}|${st}|${tag}|${bath}`) : undefined) ??
      (ct ? bag.get(`c|${ct}|${st}|${tag}`) : undefined) ??
      null
    );
  };

  const deltas: number[] = [];
  const todayRents: number[] = [];
  const propRents: number[] = [];
  const wholeRents: number[] = [];
  const splitLift: number[] = [];
  let paired = 0;
  let todayHigher = 0;
  let splitWins = 0;

  for (const r of cand) {
    const mixedComp = lookup(M, r);   // whole home, as production builds it (3+1, mixed)
    const cleanComp = lookup(C, r);   // whole home, in-home leases removed (3+1)
    const s = splitOf(r);
    if (!mixedComp || !cleanComp || !s) continue;
    const cr = (r.city_region ?? '').trim().toLowerCase();
    const ct = (r.city ?? '').trim().toLowerCase();
    const st = (r.sub_type ?? '').trim().toLowerCase();
    const suite = SN.get(`${cr}|1`) ?? SC.get(`${ct}|1`) ?? null;
    // MAIN UNIT basis: same above-grade beds with NO plus-room. Adding a suite rent to
    // the 3+1 comp would charge for the basement twice — the "+1" IS the basement.
    const mainComp = ct ? C.get(`m|${ct}|${st}|${s.above}_0`) ?? null : null;
    if (!suite || !mainComp) continue;

    const today = mixedComp * 1.6;
    const proposed = mainComp + suite;   // the SPLIT underwrite
    paired += 1;
    if (today > proposed) todayHigher += 1;
    if (proposed > cleanComp) splitWins += 1;
    todayRents.push(today);
    propRents.push(proposed);
    wholeRents.push(cleanComp);
    splitLift.push(((proposed - cleanComp) / cleanComp) * 100);
    deltas.push((today - proposed) / proposed);
  }

  console.log(`Suite-candidate listings priced & comparable: ${paired.toLocaleString()} of ${cand.length.toLocaleString()}`);
  console.log('');
  console.log(`TODAY  mixed 3+1 comp x 1.6            median $${Math.round(med(todayRents)).toLocaleString()}/mo`);
  console.log(`WHOLE  clean 3+1 comp, no multiplier    median $${Math.round(med(wholeRents)).toLocaleString()}/mo`);
  console.log(`SPLIT  clean main comp + suite comp     median $${Math.round(med(propRents)).toLocaleString()}/mo`);
  console.log('');
  console.log(`Split beats whole-home on ${splitWins.toLocaleString()} of ${paired.toLocaleString()} (${((splitWins / paired) * 100).toFixed(1)}%),  ` +
    `median lift ${med(splitLift).toFixed(1)}%`);
  console.log('');
  const pctOff = deltas.map((d) => d * 100);
  console.log(`today vs proposed:  p10 ${pctile(pctOff, 10).toFixed(1)}%  p25 ${pctile(pctOff, 25).toFixed(1)}%  ` +
    `MEDIAN ${med(pctOff).toFixed(1)}%  p75 ${pctile(pctOff, 75).toFixed(1)}%  p90 ${pctile(pctOff, 90).toFixed(1)}%`);
  console.log(`  today OVERSTATES on ${todayHigher.toLocaleString()} (${((todayHigher / paired) * 100).toFixed(1)}%), understates on the rest`);
  console.log(`  |error| > 20% on ${deltas.filter((d) => Math.abs(d) > 0.2).length.toLocaleString()} (${((deltas.filter((d) => Math.abs(d) > 0.2).length / paired) * 100).toFixed(1)}%)`);

  // What multiplier would the real suite economics imply?
  const implied = cand
    .map((r) => {
      const cleanComp = lookup(C, r);
      const cr = (r.city_region ?? '').trim().toLowerCase();
      const ct = (r.city ?? '').trim().toLowerCase();
      const suite = SN.get(`${cr}|1`) ?? SC.get(`${ct}|1`) ?? null;
      const s2 = splitOf(r);
      const st2 = (r.sub_type ?? '').trim().toLowerCase();
      const mainComp = s2 && ct ? C.get(`m|${ct}|${st2}|${s2.above}_0`) ?? null : null;
      return cleanComp && suite && mainComp ? (mainComp + suite) / cleanComp : null;
    })
    .filter((x): x is number => x != null);
  console.log('');
  console.log(`Implied multiplier if you must use one: p25 ${pctile(implied, 25).toFixed(2)}x  ` +
    `MEDIAN ${med(implied).toFixed(2)}x  p75 ${pctile(implied, 75).toFixed(2)}x   (code uses a flat 1.60x)`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
