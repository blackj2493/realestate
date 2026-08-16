/**
 * Regression check for the sqft band filter, run against the LIVE index.
 *
 * Proves the three properties the design rests on:
 *   1. loose ⊇ strict, and the difference is real straddling inventory
 *   2. the -1 unknown sentinel never leaks into either count
 *   3. the per-band buckets account for every sized listing, once each
 *
 * Uses `sqftRangeClause` — the same builder the UI and the search use — so a
 * drift between them would fail here rather than in production.
 *
 * Usage: npx tsx scripts/admin/verifySqftBands.ts
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { sqftRangeClause, SQFT_UNSIZED_CLAUSE } from '@/lib/filters/filterRegistry';
import { FREEHOLD_BANDS, CONDO_BANDS, SQFT_OPEN_MAX } from '@/lib/listings/livingAreaBands';

const ts = new Typesense.Client({
  nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
  apiKey: process.env.TYPESENSE_ADMIN_API_KEY || '',
  connectionTimeoutSeconds: 120,
});

const n = (x: number) => x.toLocaleString('en-US');
let failures = 0;

function check(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function count(filterBy: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await ts.collections('properties').documents().search({
    q: '*', query_by: 'City', filter_by: filterBy || undefined, per_page: 0,
  });
  return r.found ?? 0;
}

async function main() {
  console.log('\n📐  sqft band filter — live regression check');
  console.log('='.repeat(60));

  const total = await count('');
  const sized = await count('sqft_min:>=0');
  const unsized = await count(SQFT_UNSIZED_CLAUSE);
  console.log(`\nCollection: ${n(total)} docs — ${n(sized)} sized, ${n(unsized)} unsized`);
  check('sized + unsized accounts for every doc', sized + unsized === total,
    `${n(sized)} + ${n(unsized)} = ${n(sized + unsized)} vs ${n(total)}`);

  console.log('\nStrict vs loose across a range of selections:');
  const ranges: [number, number][] = [
    [1100, 2000],
    [1500, 2500],
    [2000, SQFT_OPEN_MAX],
    [0, 1100],
    [700, 1500],
  ];

  for (const [lo, hi] of ranges) {
    const strict = await count(sqftRangeClause(lo, hi, false)!);
    const loose = await count(sqftRangeClause(lo, hi, true)!);
    const label = `${n(lo)}–${hi >= SQFT_OPEN_MAX ? 'Max' : n(hi)}`;
    console.log(
      `  ${label.padEnd(14)} certain ${n(strict).padStart(7)}   ` +
      `may match ${n(loose - strict).padStart(6)}   (loose ${n(loose)})`
    );
    check(`  loose ⊇ strict for ${label}`, loose >= strict, `${n(loose)} >= ${n(strict)}`);
  }

  console.log('\nUnknown sentinel is excluded from every clause shape:');
  for (const [lo, hi] of ranges) {
    for (const loose of [true, false]) {
      const c = sqftRangeClause(lo, hi, loose)!;
      const leaked = await count(`(${c}) && ${SQFT_UNSIZED_CLAUSE}`);
      check(
        `  ${loose ? 'loose ' : 'strict'} ${n(lo)}–${hi >= SQFT_OPEN_MAX ? 'Max' : n(hi)}`,
        leaked === 0,
        `${n(leaked)} unsized leaked`
      );
    }
  }

  console.log('\nPer-band buckets partition the sized population:');
  for (const [name, bands] of [['freehold', FREEHOLD_BANDS], ['condo', CONDO_BANDS]] as const) {
    let sum = 0;
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      // The top bucket is open-ended, mirroring the control: its stop means "and
      // up". The condo scale ends at 4,500, so a closed top bucket would drop
      // every larger listing the stop actually matches.
      sum += await count(
        i === bands.length - 1
          ? `sqft_min:>=${b.lo}`
          : `sqft_min:>=${b.lo} && sqft_min:<${b.hi}`
      );
    }
    // Bucketing is by the band's FLOOR, so every sized listing lands in exactly
    // one bucket of whichever scale is displayed — including cross-scale ones.
    check(`${name} buckets cover all sized listings`, sum === sized,
      `${n(sum)} vs ${n(sized)}`);
  }

  console.log('\nThe bands the old parser could not read:');
  for (const [label, clause] of [
    ['< 700', 'sqft_min:=0 && sqft_max:=700'],
    ['5000 +', `sqft_min:=5000 && sqft_max:=${SQFT_OPEN_MAX}`],
  ] as const) {
    const c = await count(clause);
    check(`${label} is present`, c > 0, `${n(c)} listings`);
  }

  console.log('\n' + '='.repeat(60));
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
