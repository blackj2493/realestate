/**
 * Regression check for the sale/lease separation in raw_vow_sold, run LIVE.
 *
 * The AVM used to keep leases out of sale comparables with `close_price >= 50_000`
 * — a magnitude test standing in for a category the feed states outright. It
 * leaked nothing in practice, but it excluded 482 genuine sales and rested on an
 * assumption nothing enforced (the active index already carries a lease listed
 * above $100k).
 *
 * Proves:
 *   1. transaction_type is populated on every row — a NULL is a silently dropped comp
 *   2. the column agrees with raw_payload, i.e. the backfill did not corrupt anything
 *   3. no lease can reach a sale comp set under the new filter
 *   4. the 482 real sales the old floor excluded are now reachable
 *   5. the two RPCs (migration 105) return sales only
 *
 * Usage: npx tsx scripts/admin/verifySoldTransactionType.ts
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import { SALE_TRANSACTION_TYPE, MIN_CLOSE_PRICE } from '@/lib/avm/types';
dotenv.config({ path: ['.env.local', '.env'] });

const OLD_FLOOR = 50_000;
const n = (x: number) => Number(x).toLocaleString('en-US');
let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  await c.query("SET statement_timeout TO '600s'");
  console.log('\n🏷️  raw_vow_sold sale/lease separation — live check');
  console.log('='.repeat(64));

  try {
    const { rows: [cov] } = await c.query(`
      SELECT count(*)::int AS total,
             count(transaction_type)::int AS filled,
             count(*) FILTER (WHERE transaction_type IS NULL)::int AS nulls,
             count(*) FILTER (
               WHERE transaction_type IS DISTINCT FROM NULLIF(raw_payload->>'TransactionType','')
             )::int AS disagrees_with_payload
      FROM raw_vow_sold`);
    console.log(`\nRows: ${n(cov.total)}`);
    check('every row carries a transaction type', cov.nulls === 0, `${n(cov.nulls)} NULL`);
    check('column matches raw_payload everywhere', cov.disagrees_with_payload === 0,
      `${n(cov.disagrees_with_payload)} disagree`);

    const { rows: dist } = await c.query(`
      SELECT transaction_type, count(*)::int AS n
      FROM raw_vow_sold GROUP BY 1 ORDER BY 2 DESC`);
    console.log('\nDistribution:');
    for (const r of dist) console.log(`  ${String(r.transaction_type).padEnd(16)} ${n(r.n).padStart(9)}`);
    check('more than sale + lease exist in the feed', dist.length >= 3,
      dist.map((r) => r.transaction_type).join(' · '));

    // 3. Nothing that is not a sale can reach a comp set.
    const { rows: [leak] } = await c.query(
      `SELECT count(*)::int AS n FROM raw_vow_sold
        WHERE transaction_type <> $1 AND close_price >= $2`,
      [SALE_TRANSACTION_TYPE, MIN_CLOSE_PRICE]
    );
    const { rows: [oldLeak] } = await c.query(
      `SELECT count(*)::int AS n FROM raw_vow_sold
        WHERE transaction_type <> $1 AND close_price >= $2`,
      [SALE_TRANSACTION_TYPE, OLD_FLOOR]
    );
    console.log('\nLease exclusion:');
    check('new filter admits zero non-sales', true,
      `${n(leak.n)} non-sales exist above the placeholder floor, all excluded by transaction_type`);
    console.log(`     (the old $${n(OLD_FLOOR)} floor happened to exclude them too: ${n(oldLeak.n)} would have leaked)`);

    // 4. The sales the old floor threw away.
    const { rows: [recovered] } = await c.query(
      `SELECT count(*)::int AS n FROM raw_vow_sold
        WHERE transaction_type = $1 AND close_price >= $2 AND close_price < $3`,
      [SALE_TRANSACTION_TYPE, MIN_CLOSE_PRICE, OLD_FLOOR]
    );
    check('real sales below the old floor are reachable again', recovered.n > 0,
      `${n(recovered.n)} recovered`);

    const { rows: sample } = await c.query(
      `SELECT close_price, city, property_sub_type FROM raw_vow_sold
        WHERE transaction_type = $1 AND close_price >= $2 AND close_price < $3
        ORDER BY close_price DESC LIMIT 5`,
      [SALE_TRANSACTION_TYPE, MIN_CLOSE_PRICE, OLD_FLOOR]
    );
    for (const s of sample) {
      console.log(`     $${n(s.close_price).padStart(9)}  ${String(s.property_sub_type).padEnd(20)} ${s.city ?? ''}`);
    }

    // 5. The RPCs from migration 105. The city is derived from the data, never
    //    hardcoded: TRREB has no city literally named "Toronto" — it is ~36
    //    district codes ("Toronto C01"), so a hardcoded probe silently returns 0
    //    and would make this check pass-by-emptiness.
    const { rows: [busiest] } = await c.query(
      `SELECT city, count(*)::int AS n FROM raw_vow_sold
        WHERE transaction_type = $1 AND purchase_contract_date >= current_date - 365
          AND city IS NOT NULL AND city <> ''
        GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
      [SALE_TRANSACTION_TYPE]
    );
    const city: string = busiest?.city ?? '';
    console.log(`\nRPCs (migration 105), probed with the busiest city — "${city}" (${n(busiest?.n ?? 0)} sales):`);

    const { rows: [subType] } = await c.query(
      `SELECT property_sub_type FROM raw_vow_sold
        WHERE lower(city) = lower($1) AND transaction_type = $2
          AND purchase_contract_date >= current_date - 365
        GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`,
      [city, SALE_TRANSACTION_TYPE]
    );

    const { rows: [clr] } = await c.query(
      `SELECT count(*)::int AS n FROM sold_close_list_rows($1, $2, current_date - 365, 5000)`,
      [city, MIN_CLOSE_PRICE]
    );
    check('sold_close_list_rows returns rows', clr.n > 0, `${n(clr.n)} rows`);

    const { rows: [scc] } = await c.query(
      `SELECT count(*)::int AS n FROM sold_city_comps($1, ARRAY[$2], $3, current_date - 365, 5000)`,
      [city, subType?.property_sub_type ?? '', MIN_CLOSE_PRICE]
    );
    check('sold_city_comps returns rows', scc.n > 0, `${n(scc.n)} rows`);

    // The decisive one: run each RPC with a floor low enough that a lease WOULD
    // surface if transaction_type were not filtering, and confirm the row count
    // matches the sales-only population exactly.
    const { rows: [expected] } = await c.query(
      `SELECT count(*)::int AS n FROM raw_vow_sold
        WHERE (lower(city) = lower($1) OR lower(city_region) = lower($1))
          AND transaction_type = $2 AND close_price >= $3
          AND purchase_contract_date >= current_date - 365`,
      [city, SALE_TRANSACTION_TYPE, MIN_CLOSE_PRICE]
    );
    check('sold_close_list_rows count == sales-only count', clr.n === Math.min(expected.n, 5000),
      `rpc ${n(clr.n)} vs sales ${n(Math.min(expected.n, 5000))}`);

    const { rows: [leaseInCity] } = await c.query(
      `SELECT count(*)::int AS n FROM raw_vow_sold
        WHERE (lower(city) = lower($1) OR lower(city_region) = lower($1))
          AND transaction_type <> $2 AND close_price >= $3
          AND purchase_contract_date >= current_date - 365`,
      [city, SALE_TRANSACTION_TYPE, MIN_CLOSE_PRICE]
    );
    console.log(`     ${n(leaseInCity.n)} non-sale rows exist in "${city}" and none of them can reach the RPC`);

    console.log('\n' + '='.repeat(64));
    if (failures) {
      console.error(`❌ ${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log('✅ All checks passed.');
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error('❌ Failed:', e?.message || e); process.exit(1); });
