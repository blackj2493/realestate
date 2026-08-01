/**
 * Regression check for the search typeahead's price floor, run against the LIVE index.
 *
 * The bug: the typeahead filtered every document with `ListPrice:>=100000`, a SALE
 * floor. A lease's ListPrice is a MONTHLY RENT, so the filter hid 23,989 of 23,990
 * lease listings and all 362 `For Sub-Lease` rows — 28% of the index. And because
 * Typesense drops query tokens when a filter kills the exact match, a searched
 * address came back as a list of unrelated streets rather than as nothing.
 *
 * Proves:
 *   1. sale results are UNCHANGED (no regression on the 65k sale listings)
 *   2. every non-sale transaction type is now reachable
 *   3. the placeholder junk the floor existed to block is still blocked
 *   4. the clause partitions the index exactly — nothing silently vanishes
 *   5. the reported address resolves to exactly one hit
 *
 * Uses the SAME `anyTransactionPriceFloor()` the app runs, so drift fails here.
 *
 * Usage: npx tsx scripts/admin/verifySearchFloor.ts
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { anyTransactionPriceFloor, SALE_PRICE_FLOOR } from '@/lib/filters/fundamentals';

const ts = new Typesense.Client({
  nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
  apiKey: process.env.TYPESENSE_ADMIN_API_KEY || '',
  connectionTimeoutSeconds: 120,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;
const n = (x: number) => x.toLocaleString('en-US');
const OLD = `ListPrice:>=${SALE_PRICE_FLOOR}`;
const NEW = anyTransactionPriceFloor();

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function count(filterBy: string): Promise<number> {
  const r: AnyObj = await ts.collections('properties').documents().search({
    q: '*', query_by: 'City', filter_by: filterBy || undefined, per_page: 0,
  });
  return r.found ?? 0;
}

async function suggest(q: string, filterBy: string) {
  const r: AnyObj = await ts.collections('properties').documents().search({
    q, query_by: 'UnparsedAddress,City,CityRegion', filter_by: filterBy, per_page: 5,
  });
  return { found: r.found ?? 0, hits: (r.hits ?? []).map((h: AnyObj) => h.document) };
}

async function main() {
  console.log('\n🔎  search typeahead price floor — live regression check');
  console.log('='.repeat(66));
  console.log(`\nold: ${OLD}\nnew: ${NEW}`);

  const total = await count('');
  const oldPass = await count(OLD);
  const newPass = await count(NEW);
  console.log(`\nIndex ${n(total)} docs — old floor admitted ${n(oldPass)}, new floor admits ${n(newPass)}`);
  check('the new floor admits strictly more', newPass > oldPass,
    `+${n(newPass - oldPass)} listings become findable`);

  // 1. No regression for sales — this is the one that must not move.
  console.log('\nSale listings are unaffected:');
  const saleOld = await count(`TransactionType:=\`For Sale\` && ${OLD}`);
  const saleNew = await count(`TransactionType:=\`For Sale\` && ${NEW}`);
  check('sale count identical before/after', saleOld === saleNew, `${n(saleOld)} = ${n(saleNew)}`);

  // 2. Every transaction type the feed actually emits is reachable.
  console.log('\nEvery transaction type in the feed is reachable:');
  const r: AnyObj = await ts.collections('properties').documents().search({
    q: '*', query_by: 'City', facet_by: 'TransactionType', max_facet_values: 30, per_page: 0,
  });
  const values: string[] =
    (r.facet_counts ?? []).find((f: AnyObj) => f.field_name === 'TransactionType')?.counts
      ?.map((c: AnyObj) => c.value) ?? [];
  check('feed exposes more than sale + lease', values.length >= 3, values.join(' · '));
  for (const v of values) {
    const all = await count(`TransactionType:=\`${v}\``);
    const pass = await count(`TransactionType:=\`${v}\` && ${NEW}`);
    const pct = all ? ((100 * pass) / all).toFixed(1) : '0';
    check(`  "${v}" reachable`, pass > 0 && pass / all > 0.9,
      `${n(pass)}/${n(all)} (${pct}%)`);
  }

  // 3. The junk the floor existed to block is still blocked.
  console.log('\nPlaceholder rows are still excluded:');
  const junkSale = await count(`TransactionType:=\`For Sale\` && ListPrice:<${SALE_PRICE_FLOOR} && ${NEW}`);
  const zeroLease = await count(`TransactionType:!=\`For Sale\` && ListPrice:<1 && ${NEW}`);
  check('no sub-$100k sale rows admitted', junkSale === 0, `${n(junkSale)} leaked`);
  check('no $0 lease rows admitted', zeroLease === 0, `${n(zeroLease)} leaked`);

  // 4. Nothing vanishes: admitted + blocked must equal the whole index.
  console.log('\nThe clause partitions the index — nothing silently disappears:');
  const blockedSale = await count(`TransactionType:=\`For Sale\` && ListPrice:<${SALE_PRICE_FLOOR}`);
  const blockedOther = await count(`TransactionType:!=\`For Sale\` && ListPrice:<1`);
  check('admitted + blocked = total', newPass + blockedSale + blockedOther === total,
    `${n(newPass)} + ${n(blockedSale)} + ${n(blockedOther)} = ${n(newPass + blockedSale + blockedOther)} vs ${n(total)}`);

  // 5. The listing that started this, and the noise it used to return.
  console.log('\nThe reported address:');
  const before = await suggest('5967 perth', OLD);
  const after = await suggest('5967 perth', NEW);
  console.log(`  old floor → ${n(before.found)} hits (fuzzy token-drop noise):`);
  for (const d of before.hits.slice(0, 3)) console.log(`      ${d.id}  ${d.UnparsedAddress}`);
  console.log(`  new floor → ${n(after.found)} hit(s):`);
  for (const d of after.hits) {
    console.log(`      ${d.id}  $${n(d.ListPrice)}  ${d.TransactionType}  ${d.UnparsedAddress}`);
  }
  check('resolves to exactly one listing', after.found === 1);
  check('it is the right one', after.hits[0]?.id === 'X13469792', after.hits[0]?.id ?? 'none');
  check('the old floor did NOT return it',
    !before.hits.some((d: AnyObj) => d.id === 'X13469792'),
    `old returned ${n(before.found)} unrelated rows instead`);

  console.log('\n' + '='.repeat(66));
  if (failures) {
    console.error(`❌ ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('✅ All checks passed.');
}

main().catch((e) => {
  console.error('❌ Failed:', e?.message || e);
  process.exit(1);
});
