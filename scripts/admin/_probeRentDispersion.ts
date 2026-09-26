/**
 * READ-ONLY CHECKPOINT: how much of the LIVE book does the 150 dispersion gate withhold?
 *
 * WHY THIS EXISTS. The 1.46% that justified the gate was measured on held-out CLOSED LEASES —
 * the population the index is built from. Active for-sale listings are a different population:
 * different geographic mix, different bed/bath/size mix, and they land on the ladder's rungs in
 * different proportions. The share gated there is an OPEN QUESTION, not a restatement, and
 * shipping a withhold rule without measuring it on the surface it affects would be guessing.
 *
 * It calls the real `fetchRentAVM`, not a reimplementation of the ladder. A probe that
 * rebuilt the walk would answer a question about the probe.
 *
 * Sampling rather than the whole book: a full pass is ~an hour of round trips (the ladder is
 * up to 10 per listing). At n=3,000 the standard error on a ~1.5% share is ~0.22pp, which is
 * far tighter than any decision here needs.
 *
 *   npx tsx --env-file=.env scripts/admin/_probeRentDispersion.ts
 *   npx tsx --env-file=.env scripts/admin/_probeRentDispersion.ts --n=6000
 *
 * Writes nothing. Safe to run against production at any time.
 */
import { Client } from 'pg';
import { fetchRentAVM } from '../worker/services/rentAVM';
import {
  rentTierConfidence, rentSpreadTooWide, RENT_DISPERSION_CEILING,
} from '@/lib/metrics/rentTier';

const CLOSED_STATUSES = [
  'sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended',
];
const N = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4)) || 3000;
const CONCURRENCY = 8;

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const money = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;
const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

async function mapPool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await f(items[i]);
    }
  }));
  return out;
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || process.env.DIRECT_DB_URL,
  });
  await client.connect();

  // TABLESAMPLE would be cheaper but biases toward physically clustered rows; the book is
  // written in listing_key order, which correlates with board area. ORDER BY random() over
  // ~100k rows is a couple of seconds and is actually uniform.
  const { rows } = await client.query(
    `SELECT listing_key, full_payload
       FROM listings
      WHERE coalesce(standard_status,'') <> ALL($1::text[])
      ORDER BY random()
      LIMIT $2`,
    [CLOSED_STATUSES, N],
  );
  console.log(`sampled ${rows.length.toLocaleString()} active listings\n`);

  type Probe = {
    key: string;
    hasData: boolean;
    tier: string | null;
    dispersion: number | null;
    sample: number | null;
    rent: number;
    gated: boolean;
  };

  const probes = await mapPool(rows, CONCURRENCY, async (r): Promise<Probe> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = r.full_payload as any;
    try {
      const a = await fetchRentAVM({
        city: raw.City || '',
        cityRegion: raw.CityRegion || raw.City || '',
        propertySubType: raw.PropertySubType || '',
        bedroomsTotal: raw.BedroomsTotal || 0,
        bedroomsAboveGrade: raw.BedroomsAboveGrade,
        bedroomsBelowGrade: raw.BedroomsBelowGrade,
        bathroomsTotal: raw.BathroomsTotalInteger || 0,
        county: raw.CountyOrParish,
        livingAreaRange: raw.LivingAreaRange,
      });
      const conf = rentTierConfidence(a.match_tier, a.dispersion ?? null);
      return {
        key: r.listing_key,
        hasData: a.has_data,
        tier: a.match_tier ?? null,
        dispersion: a.dispersion ?? null,
        sample: a.sample_count ?? null,
        rent: Math.round((a.annual_rent || 0) / 12),
        gated: a.has_data && rentSpreadTooWide(conf),
      };
    } catch (e) {
      console.warn(`  ${r.listing_key}: ${(e as Error).message}`);
      return { key: r.listing_key, hasData: false, tier: null, dispersion: null, sample: null, rent: 0, gated: false };
    }
  });

  const withRent = probes.filter((p) => p.hasData);
  const known = withRent.filter((p) => p.dispersion != null);
  const gated = withRent.filter((p) => p.gated);

  console.log('COVERAGE');
  console.log(`  rent estimated:        ${withRent.length.toLocaleString()} / ${probes.length.toLocaleString()}  (${pct(withRent.length / probes.length)})`);
  console.log(`  spread known:          ${known.length.toLocaleString()}  (${pct(known.length / Math.max(1, withRent.length))} of those)`);
  if (known.length < withRent.length) {
    console.log('  ^ any shortfall here means cohorts still carry NULL quartiles — the index');
    console.log('    has not been rebuilt since 150, and the gate is OFF for those listings.');
  }

  console.log(`\nTHE GATE  (withhold when (p75-p25)/median > ${RENT_DISPERSION_CEILING})`);
  console.log(`  WOULD WITHHOLD:        ${gated.length.toLocaleString()}  (${pct(gated.length / Math.max(1, withRent.length))} of listings with a rent)`);
  console.log(`  backtest predicted:    1.46%  (measured on closed leases, a different population)`);

  if (known.length) {
    const ds = known.map((p) => p.dispersion!);
    const q = (p: number) => [...ds].sort((a, b) => a - b)[Math.floor(ds.length * p)];
    console.log('\nSPREAD DISTRIBUTION across the live book');
    console.log(`  p50 ${q(0.5).toFixed(3)}   p75 ${q(0.75).toFixed(3)}   p90 ${q(0.90).toFixed(3)}   p95 ${q(0.95).toFixed(3)}   p99 ${q(0.99).toFixed(3)}`);
    console.log(`  (held-out leases: 0.096 median overall, 0.237 median among the blow-ups)`);
  }

  console.log('\nGATED SHARE BY RUNG');
  const byTier = new Map<string, { n: number; g: number }>();
  for (const p of withRent) {
    const t = p.tier ?? '(none)';
    const b = byTier.get(t) ?? { n: 0, g: 0 };
    b.n++; if (p.gated) b.g++;
    byTier.set(t, b);
  }
  for (const [t, v] of [...byTier.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${t.padEnd(16)} ${String(v.n).padStart(5)} listings   ${String(v.g).padStart(4)} gated  (${pct(v.g / v.n)})`);
  }

  if (gated.length) {
    console.log('\nA SAMPLE OF WHAT GETS WITHHELD — eyeball these; they should look genuinely odd');
    console.log('  listing        rung              rent/mo   spread   comps');
    for (const p of gated.slice(0, 15)) {
      console.log(`  ${p.key.padEnd(13)}  ${(p.tier ?? '?').padEnd(16)}  ${money(p.rent).padStart(8)}   ${p.dispersion!.toFixed(3)}    ${p.sample ?? '?'}`);
    }
    console.log(`\n  median rent among gated: ${money(median(gated.map((p) => p.rent)))}`);
    console.log(`  median rent among kept:  ${money(median(withRent.filter((p) => !p.gated).map((p) => p.rent)))}`);
  }

  // The two listings that started this. Neither may be in the random sample, so ask directly.
  console.log('\nTHE TWO REPORTED LISTINGS');
  for (const key of ['C13729206', 'W13746676']) {
    const { rows: one } = await client.query(
      `SELECT full_payload FROM listings WHERE listing_key = $1`, [key],
    );
    if (!one.length) { console.log(`  ${key}: not in listings`); continue; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = one[0].full_payload as any;
    const a = await fetchRentAVM({
      city: raw.City || '',
      cityRegion: raw.CityRegion || raw.City || '',
      propertySubType: raw.PropertySubType || '',
      bedroomsTotal: raw.BedroomsTotal || 0,
      bedroomsAboveGrade: raw.BedroomsAboveGrade,
      bedroomsBelowGrade: raw.BedroomsBelowGrade,
      bathroomsTotal: raw.BathroomsTotalInteger || 0,
      county: raw.CountyOrParish,
      livingAreaRange: raw.LivingAreaRange,
    });
    const conf = rentTierConfidence(a.match_tier, a.dispersion ?? null);
    const rent = Math.round((a.annual_rent || 0) / 12);
    console.log(
      `  ${key}  ${(raw.UnparsedAddress ?? '').slice(0, 34).padEnd(34)}` +
      ` ${money(rent).padStart(8)}  rung=${(a.match_tier ?? 'none').padEnd(15)}` +
      ` spread=${a.dispersion == null ? 'unknown' : a.dispersion.toFixed(3)}  -> ${conf}` +
      `${rentSpreadTooWide(conf) ? '  WITHHELD' : ''}`,
    );
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
