/**
 * Deterministic unit tests for src/lib/condo/feeStability.ts.
 * Mirrors scripts/worker/test-condition-scoring.ts (simple eq() counter + exit code).
 *
 * Run: npx tsx scripts/worker/test-fee-stability.ts
 */

import {
  parseLivingAreaRange,
  isCondo,
  resolveSqft,
  computeFeePsf,
  bundlesUtilities,
  median,
  quantile,
  halfYearPeriod,
  classifyAreaPosition,
  classifyTrend,
  trendConfidence,
  annualFeeTrendPct,
  assembleCorpStats,
  buildFeeStabilityResult,
  type AreaStats,
  type CorpStats,
} from '@/lib/condo/feeStability';

let pass = 0;
let fail = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log(`  ✅ ${name} = ${g}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}: got ${g}, want ${w}`);
  }
}

console.log('\nparseLivingAreaRange:');
eq('range midpoint', parseLivingAreaRange('1500-2000'), 1750);
eq('odd range rounds', parseLivingAreaRange('700-799'), 750);
eq('open-ended +', parseLivingAreaRange('5000+'), 5000);
eq('single number', parseLivingAreaRange('700'), 700);
eq('empty → null', parseLivingAreaRange(''), null);
eq('garbage → null', parseLivingAreaRange('N/A'), null);

console.log('\nisCondo:');
eq('Condo Apartment', isCondo({ PropertySubType: 'Condo Apartment' }), true);
eq('Condo Townhouse', isCondo({ PropertySubType: 'Condo Townhouse' }), true);
eq('Co-Op Apartment', isCondo({ PropertySubType: 'Co-Op Apartment' }), true);
eq('Comm Element Condo', isCondo({ PropertySubType: 'Comm Element Condo' }), true);
eq('AssociationYN flag', isCondo({ PropertySubType: 'Att/Row/Townhouse', AssociationYN: true }), true);
eq('Detached → false', isCondo({ PropertySubType: 'Detached' }), false);
eq('empty → false', isCondo({}), false);

console.log('\nresolveSqft:');
eq('exact BuildingAreaTotal', resolveSqft({ BuildingAreaTotal: 900 }), 900);
eq('range fallback', resolveSqft({ LivingAreaRange: '700-799' }), 750);
eq('exact preferred over range', resolveSqft({ BuildingAreaTotal: 850, LivingAreaRange: '700-799' }), 850);
eq('too small → null', resolveSqft({ BuildingAreaTotal: 50 }), null);
eq('too large → null', resolveSqft({ BuildingAreaTotal: 999999 }), null);
eq('nothing → null', resolveSqft({}), null);

console.log('\ncomputeFeePsf:');
eq('normal', computeFeePsf(700, 1000), 0.7);
eq('zero fee → null', computeFeePsf(0, 1000), null);
eq('zero sqft → null', computeFeePsf(700, 0), null);
eq('absurd psf → null', computeFeePsf(50000, 1000), null);
eq('tiny psf → null', computeFeePsf(10, 1000), null);

console.log('\nbundlesUtilities:');
eq('heat bundled', bundlesUtilities(['Common Elements', 'Heat', 'Building Insurance']), true);
eq('water bundled', bundlesUtilities('Water, Parking'), true);
eq('standard only → false', bundlesUtilities(['Common Elements', 'Building Insurance', 'Parking']), false);
eq('empty → false', bundlesUtilities([]), false);

console.log('\nmedian / quantile:');
eq('median odd', median([3, 1, 2]), 2);
eq('median even', median([1, 2, 3, 4]), 2.5);
eq('q25 interp', quantile([1, 2, 3, 4], 0.25), 1.75);
eq('q75 interp', quantile([1, 2, 3, 4], 0.75), 3.25);

console.log('\nhalfYearPeriod:');
eq('Jan → H1', halfYearPeriod('2024-01-15'), '2024-H1');
eq('Jul → H2', halfYearPeriod('2024-07-01'), '2024-H2');
eq('invalid → empty', halfYearPeriod('not-a-date'), '');

console.log('\nclassifyAreaPosition:');
eq(
  'below p25',
  classifyAreaPosition(0.5, { medianPsf: 0.8, p25Psf: 0.6, p75Psf: 1.0 }),
  { position: 'below', pctVsMedian: -37.5 } // 0.5 is exactly 37.5% below 0.8 (2-decimal)
);
eq(
  'typical',
  classifyAreaPosition(0.75, { medianPsf: 0.8, p25Psf: 0.6, p75Psf: 1.0 }),
  { position: 'typical', pctVsMedian: -6.25 }
);
eq(
  'above p75',
  classifyAreaPosition(1.2, { medianPsf: 0.8, p25Psf: 0.6, p75Psf: 1.0 }),
  { position: 'above', pctVsMedian: 50 }
);

console.log('\nclassifyTrend (annualized %/yr, baseline ~3%/yr):');
eq('negative → Stable', classifyTrend(-5), 'Stable');
eq('at baseline → Stable', classifyTrend(3), 'Stable');
eq('moderate', classifyTrend(5), 'Moderate');
eq('moderate upper', classifyTrend(6), 'Moderate');
eq('rising', classifyTrend(8), 'Rising');
eq('rising upper', classifyTrend(10), 'Rising');
eq('steep', classifyTrend(15), 'Steep');

console.log('\nannualFeeTrendPct (robust log-slope + shrinkage):');
// Flat fees over a full year → raw slope 0, shrunk toward baseline: (1 − 6/(6+12))·2.5 = 1.6667.
const flat = [2024.0, 2024.2, 2024.4, 2024.6, 2024.8, 2025.0].map((t) => ({ t, psf: 0.8 }));
eq('flat fees → baseline-shrunk', annualFeeTrendPct(flat), 1.6667);
// Too few sales (n=5) → null.
eq('too few sales → null', annualFeeTrendPct(flat.slice(0, 5)), null);
// Enough sales but no time span → null.
eq('no span → null', annualFeeTrendPct([2024, 2024, 2024, 2024, 2024, 2024].map((t) => ({ t, psf: 0.8 }))), null);
// All below the trend floor → filtered out → too few → null (garbage can't drive a trend).
eq('below floor → null', annualFeeTrendPct(flat.map((s) => ({ ...s, psf: 0.2 }))), null);
// A genuine ~2%/mo-ish rise → positive, above baseline, but shrinkage keeps it sane (not Steep).
const rising = [
  { t: 2024.0, psf: 0.7 }, { t: 2024.2, psf: 0.72 }, { t: 2024.4, psf: 0.74 },
  { t: 2024.6, psf: 0.76 }, { t: 2024.8, psf: 0.78 }, { t: 2025.0, psf: 0.8 },
];
const risingPct = annualFeeTrendPct(rising);
eq('rising: positive & bounded', risingPct != null && risingPct > 3 && risingPct <= 10, true);
eq('rising: not Steep after shrink', classifyTrend(risingPct ?? 99) !== 'Steep', true);

console.log('\ntrendConfidence:');
eq('HIGH', trendConfidence(16, 4), 'HIGH');
eq('MEDIUM', trendConfidence(8, 3), 'MEDIUM');
eq('LOW (few periods)', trendConfidence(16, 2), 'LOW');
eq('LOW (few samples)', trendConfidence(7, 3), 'LOW');

console.log('\nassembleCorpStats:');
// Singleton buckets are dropped so one luxury sale can't anchor a period; with only
// one qualifying bucket left the whole trend is suppressed (benchmark-only).
eq(
  'singleton outlier → null',
  assembleCorpStats(
    [
      { date: '2024-09-01', psf: 0.8733 },
      { date: '2025-01-15', psf: 0.8744 }, { date: '2025-02-01', psf: 0.87 },
      { date: '2025-03-01', psf: 0.88 }, { date: '2025-03-15', psf: 0.86 },
      { date: '2025-04-01', psf: 0.89 }, { date: '2025-05-01', psf: 0.87 },
      { date: '2025-05-15', psf: 0.88 }, { date: '2025-06-01', psf: 0.87 },
      { date: '2025-09-01', psf: 2.1575 },
    ],
    false
  ),
  null
);
eq(
  'too few total → null',
  assembleCorpStats(
    [
      { date: '2023-02-01', psf: 0.7 }, { date: '2023-03-01', psf: 0.71 },
      { date: '2023-08-01', psf: 0.72 }, { date: '2023-09-01', psf: 0.73 },
      { date: '2024-02-01', psf: 0.74 }, { date: '2024-03-01', psf: 0.75 },
    ],
    false
  ),
  null
);
const healthy = assembleCorpStats(
  [
    { date: '2023-02-01', psf: 0.7 }, { date: '2023-03-01', psf: 0.71 }, { date: '2023-05-01', psf: 0.72 },
    { date: '2023-08-01', psf: 0.74 }, { date: '2023-09-01', psf: 0.75 }, { date: '2023-11-01', psf: 0.76 },
    { date: '2024-02-01', psf: 0.79 }, { date: '2024-03-01', psf: 0.8 }, { date: '2024-05-01', psf: 0.81 },
  ],
  false
);
eq('healthy: buckets', healthy?.buckets.length, 3);
eq('healthy: sampleCount', healthy?.sampleCount, 9);
eq('healthy: annual positive & bounded', !!healthy && healthy.annualPct > 0 && healthy.annualPct <= 40, true);
eq('healthy: not Steep after shrink', classifyTrend(healthy ? healthy.annualPct : 99) !== 'Steep', true);

console.log('\nbuildFeeStabilityResult:');
const area: AreaStats = {
  medianPsf: 0.8,
  p25Psf: 0.6,
  p75Psf: 1.0,
  sampleCount: 20,
  inclusionsMixed: false,
};
const corp: CorpStats = {
  buckets: [
    { period: '2023-H1', medianPsf: 0.7, n: 4 },
    { period: '2023-H2', medianPsf: 0.75, n: 5 },
    { period: '2024-H1', medianPsf: 0.8, n: 3 },
  ],
  annualPct: 8, // %/yr → Rising band (>6, ≤10)
  sampleCount: 12,
  inclusionsMixed: false,
};
const condoPayload = { PropertySubType: 'Condo Apartment', AssociationFee: 600, BuildingAreaTotal: 800 };

eq(
  'non-condo unavailable',
  buildFeeStabilityResult({ payload: { PropertySubType: 'Detached' }, cityRegion: 'X', area, corp }).reason,
  'not_condo'
);
eq(
  'condo no area → insufficient',
  buildFeeStabilityResult({ payload: condoPayload, cityRegion: 'X', area: null, corp: null }).reason,
  'insufficient_area_data'
);

const sparse = buildFeeStabilityResult({ payload: condoPayload, cityRegion: 'Mimico', area, corp: null });
eq('sparse: available', sparse.available, true);
eq('sparse: unit psf', sparse.unitFeePsf, 0.75);
eq('sparse: trend suppressed', sparse.trend, null);
eq('sparse: area position', sparse.area?.position, 'typical');

const full = buildFeeStabilityResult({ payload: condoPayload, cityRegion: 'Mimico', area, corp });
eq('full: trend band', full.trend?.band, 'Rising');
eq('full: trend confidence', full.trend?.confidence, 'MEDIUM');
eq('full: trend buckets count', full.trend?.buckets.length, 3);

const mixed = buildFeeStabilityResult({
  payload: condoPayload,
  cityRegion: 'Mimico',
  area,
  corp: { ...corp, inclusionsMixed: true },
});
eq('inclusions propagate from corp', mixed.area?.inclusionsMixed, true);

// Below-threshold corp → trend suppressed even when present.
const thinCorp: CorpStats = { ...corp, sampleCount: 4 };
eq(
  'thin corp → benchmark only',
  buildFeeStabilityResult({ payload: condoPayload, cityRegion: 'Mimico', area, corp: thinCorp }).trend,
  null
);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
