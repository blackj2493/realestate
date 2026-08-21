/**
 * Migration 125 impact canary — READ-ONLY.
 *
 * Answers the only question that matters before the recompute runs: what happens to
 * every published cap rate when the 1.6x suite multiplier is retired, the whole-home
 * cohorts lose their in-home leases, and observed suites gain a measured rent line.
 *
 * Builds BOTH index versions in memory and runs the real calculateFinancialMetrics
 * against each, so nothing is written and the production ladder is untouched.
 *
 *   OLD  mixed cohorts, x1.6 where multi_unit_status is one of the three, no suite line
 *   NEW  clean cohorts, no multiplier, measured suite rent where hasObservedSuite()
 *
 * Two deliberate simplifications, applied IDENTICALLY to both sides so the delta stays
 * honest: calculation_price is listPrice (resolveRatioPrice is a DB round trip per
 * listing) and the mill rate is the engine default. Absolute cap rates here will not
 * match production to the basis point; the SHIFT is what this measures.
 *
 * Usage: npx tsx scripts/admin/suite-rent-impact-canary.ts [--sample=25000]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { bedSplit } from '@/lib/listings/bedSplit';
import { subTypeFamily } from '@/lib/listings/subTypeFamily';
import { isPartialUnitRental } from '@/lib/listings/inHomeUnit';
import { hasObservedSuite } from '@/lib/listings/observedSuite';
import { calculateMultiUnitPotential } from '../worker/services/multiUnitCalculator';
import { calculateFinancialMetrics } from '../worker/services/financialMetrics';
import { MIN_COHORT_SAMPLES, SUITE_BED_CAP } from '../worker/services/rentModel';

const SAMPLE = Number(process.argv.find((a) => a.startsWith('--sample='))?.split('=')[1] ?? 25000);
const MULTIPLIED = new Set(['EXISTING_MULTI_UNIT', 'PRIME_CANDIDATE', 'MARGINAL_CANDIDATE']);

const med = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pctile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type Bag = Map<string, number[]>;
const push = (m: Bag, k: string, v: number) => {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
};
const finish = (m: Bag) =>
  new Map([...m].filter(([, v]) => v.length >= MIN_COHORT_SAMPLES).map(([k, v]) => [k, med(v)]));

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  // ── Build both ladders ────────────────────────────────────────────────────────
  const { rows: leases } = await client.query(
    `SELECT list_price, city, city_region,
            btrim(coalesce(property_sub_type,'')) AS sub_type,
            full_payload->>'UnparsedAddress'       AS address,
            full_payload->>'BedroomsTotal'         AS bt,
            full_payload->>'BedroomsAboveGrade'    AS ba,
            full_payload->>'BedroomsBelowGrade'    AS bb,
            full_payload->>'BathroomsTotalInteger' AS bath,
            full_payload->>'CountyOrParish'        AS county
       FROM listings
      WHERE lower(coalesce(full_payload->>'TransactionType','')) ~ '(leas|rent)'
        AND list_price BETWEEN 500 AND 25000`
  );

  const old: Bag = new Map();
  const neu: Bag = new Map();
  const suite: Bag = new Map();

  const wholeKeys = (r: Record<string, string | null>, above: number | null, den: number | null) => {
    const cr = (r.city_region ?? '').trim().toLowerCase();
    const ct = (r.city ?? '').trim().toLowerCase();
    const st = (r.sub_type ?? '').trim().toLowerCase();
    const cy = (r.county ?? '').trim().toLowerCase();
    const bath = num(r.bath);
    const fam = subTypeFamily((r.sub_type ?? '').trim());
    const tag = above === null ? `t${num(r.bt)}` : `s${above}_${den}`;
    return [
      cr && bath != null ? `n|${cr}|${st}|${tag}|${bath}` : null,
      ct && bath != null ? `b|${ct}|${st}|${tag}|${bath}` : null,
      ct ? `c|${ct}|${st}|${tag}` : null,
      ct && fam ? `f|${ct}|${fam}|${tag}` : null,
      cy ? `y|${cy}|${st}|${tag}` : null,
    ].filter(Boolean) as string[];
  };

  for (const r of leases) {
    const rent = Number(r.list_price);
    const beds = num(r.bt);
    const st = (r.sub_type ?? '').trim();
    if (!st || beds == null) continue;
    const s = bedSplit({ BedroomsTotal: beds, BedroomsAboveGrade: num(r.ba), BedroomsBelowGrade: num(r.bb) });
    const dims: Array<[number | null, number | null]> = [[null, null]];
    if (s) dims.push([s.above, s.den]);

    const part = isPartialUnitRental(r.address, st);
    for (const [above, den] of dims) {
      for (const k of wholeKeys(r, above, den)) {
        push(old, k, rent);            // production today: everything pooled
        if (!part) push(neu, k, rent); // 125: in-home units removed
      }
    }
    if (part) {
      const sb = Math.min(SUITE_BED_CAP, Math.max(0, beds));
      const cr = (r.city_region ?? '').trim().toLowerCase();
      const ct = (r.city ?? '').trim().toLowerCase();
      if (cr) push(suite, `sn|${cr}|${sb}`, rent);
      if (ct) push(suite, `sc|${ct}|${sb}`, rent);
    }
  }
  const OLD = finish(old);
  const NEW = finish(neu);
  const SUITE = finish(suite);
  console.log(`Ladders built — whole-home cohorts: today ${OLD.size.toLocaleString()}, cleaned ${NEW.size.toLocaleString()}; suite ${SUITE.size.toLocaleString()}`);

  const walk = (bag: Map<string, number>, r: Record<string, string | null>) => {
    const beds = num(r.bt);
    if (beds == null) return null;
    const s = bedSplit({ BedroomsTotal: beds, BedroomsAboveGrade: num(r.ba), BedroomsBelowGrade: num(r.bb) });
    const dims: Array<[number | null, number | null]> = [];
    if (s) dims.push([s.above, s.den]);
    dims.push([null, null]);
    for (const [above, den] of dims) {
      for (const k of wholeKeys(r, above, den)) {
        const v = bag.get(k);
        if (v != null) return v;
      }
    }
    return null;
  };
  const suiteFor = (r: Record<string, string | null>) => {
    const cr = (r.city_region ?? '').trim().toLowerCase();
    const ct = (r.city ?? '').trim().toLowerCase();
    const bb = num(r.bb);
    const b = Math.min(SUITE_BED_CAP, bb && bb > 0 ? bb : 1);
    return (
      (cr ? SUITE.get(`sn|${cr}|${b}`) : undefined) ??
      (cr && b !== 1 ? SUITE.get(`sn|${cr}|1`) : undefined) ??
      (ct ? SUITE.get(`sc|${ct}|${b}`) : undefined) ??
      (ct && b !== 1 ? SUITE.get(`sc|${ct}|1`) : undefined) ??
      null
    );
  };

  // ── Score the for-sale book ───────────────────────────────────────────────────
  const { rows: sale } = await client.query(
    `SELECT list_price, city, city_region,
            btrim(coalesce(property_sub_type,'')) AS sub_type,
            full_payload->>'BedroomsTotal'         AS bt,
            full_payload->>'BedroomsAboveGrade'    AS ba,
            full_payload->>'BedroomsBelowGrade'    AS bb,
            full_payload->>'BathroomsTotalInteger' AS bath,
            full_payload->>'CountyOrParish'        AS county,
            full_payload->>'TaxAnnualAmount'       AS taxes,
            full_payload->>'AssociationFee'        AS fee,
            full_payload->>'PropertyType'          AS "PropertyType",
            full_payload->>'PropertySubType'       AS "PropertySubType",
            full_payload->>'CondoCorpNumber'       AS "CondoCorpNumber",
            full_payload->'Basement'               AS "Basement",
            full_payload->>'KitchensBelowGrade'    AS "KitchensBelowGrade",
            left(coalesce(full_payload->>'PublicRemarks',''), 600) AS "PublicRemarks",
            full_payload->>'WashroomsType1Level'   AS "WashroomsType1Level",
            full_payload->>'WashroomsType2Level'   AS "WashroomsType2Level",
            full_payload->>'WashroomsType3Level'   AS "WashroomsType3Level",
            full_payload->>'ParkingTotal'          AS "ParkingTotal"
       FROM listings
      WHERE lower(coalesce(full_payload->>'TransactionType','')) ~ 'sale'
        AND list_price > 50000
      ORDER BY listing_key
      LIMIT ${SAMPLE}`
  );

  const run = (r: Record<string, unknown>, annualRent: number, hasRent: boolean, suiteMonthly: number) =>
    calculateFinancialMetrics({
      annual_rent: annualRent,
      annual_rent_p10: annualRent * 0.85,
      has_rent_data: hasRent,
      calculation_price: Number(r.list_price),
      is_price_discovery: false,
      propertySubType: (r.sub_type as string) || '',
      listPrice: Number(r.list_price),
      transactionType: 'For Sale',
      taxAnnualAmount: num(r.taxes),
      associationFee: num(r.fee),
      maintenanceExpense: null,
      insuranceExpense: null,
      baseMillRate: 0.0095,
      isCondo: !!(String(r.PropertyType ?? '').includes('Condo') || r.CondoCorpNumber),
      suite_monthly_rent: suiteMonthly,
      suite_monthly_rent_p10: suiteMonthly * 0.85,
    });

  const before: number[] = [];
  const after: number[] = [];
  const groups = new Map<string, { n: number; before: number[]; after: number[] }>();
  let lostComp = 0;
  let gainedSuite = 0;

  for (const r of sale) {
    const rr = r as Record<string, string | null>;
    const oldComp = walk(OLD, rr);
    const newComp = walk(NEW, rr);
    const { multi_unit_status } = calculateMultiUnitPotential({
      ...r,
      KitchensBelowGrade: num(r.KitchensBelowGrade),
      ParkingTotal: num(r.ParkingTotal),
    } as never);

    const oldMult = MULTIPLIED.has(multi_unit_status) ? 1.6 : 1;
    const observed = hasObservedSuite(r as never);
    const suiteMonthly = observed ? (suiteFor(rr) ?? 0) : 0;
    if (observed && suiteMonthly > 0) gainedSuite += 1;
    if (oldComp != null && newComp == null) lostComp += 1;

    const b = run(r, (oldComp ?? 0) * 12 * oldMult, oldComp != null, 0);
    const a = run(r, (newComp ?? 0) * 12, newComp != null, suiteMonthly);
    if (!b.cap_rate_est && !a.cap_rate_est) continue;

    const key = observed ? 'observed suite'
      : MULTIPLIED.has(multi_unit_status) ? 'scored candidate (loses x1.6)'
      : 'no suite signal';
    const g = groups.get(key) ?? { n: 0, before: [], after: [] };
    g.n += 1;
    g.before.push(b.cap_rate_est);
    g.after.push(a.cap_rate_est);
    groups.set(key, g);
    before.push(b.cap_rate_est);
    after.push(a.cap_rate_est);
  }

  console.log(`Sampled ${sale.length.toLocaleString()} for-sale listings; ${before.length.toLocaleString()} carry a cap rate on at least one side.`);
  console.log('');
  console.log('cap_rate_est distribution');
  console.log('                       p10     p25   MEDIAN     p75     p90');
  const line = (label: string, xs: number[]) =>
    console.log(
      `  ${label.padEnd(18)} ${[10, 25, 50, 75, 90]
        .map((p) => `${(p === 50 ? med(xs) : pctile(xs, p)).toFixed(2)}%`.padStart(7))
        .join(' ')}`
    );
  line('today', before);
  line('after 125', after);
  console.log('');
  console.log('by group');
  for (const [k, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
    const d = med(g.after) - med(g.before);
    console.log(
      `  ${k.padEnd(30)} n=${g.n.toLocaleString().padStart(7)}   ` +
        `${med(g.before).toFixed(2)}% -> ${med(g.after).toFixed(2)}%   ${d >= 0 ? '+' : ''}${d.toFixed(2)} pts`
    );
  }
  console.log('');
  console.log(`Listings that GAIN a measured suite line : ${gainedSuite.toLocaleString()}`);
  console.log(`Listings that LOSE their comp entirely   : ${lostComp.toLocaleString()}  (cohort fell under n=${MIN_COHORT_SAMPLES} once in-home leases were removed)`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
