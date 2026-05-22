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
  { position: 'below', pctVsMedian: -38 }
);
eq(
  'typical',
  classifyAreaPosition(0.75, { medianPsf: 0.8, p25Psf: 0.6, p75Psf: 1.0 }),
  { position: 'typical', pctVsMedian: -6 }
);
eq(
  'above p75',
  classifyAreaPosition(1.2, { medianPsf: 0.8, p25Psf: 0.6, p75Psf: 1.0 }),
  { position: 'above', pctVsMedian: 50 }
);

console.log('\nclassifyTrend (baseline 6% / 24mo):');
eq('negative → Stable', classifyTrend(-3), 'Stable');
eq('at baseline → Stable', classifyTrend(6), 'Stable');
eq('moderate', classifyTrend(10), 'Moderate');
eq('moderate upper', classifyTrend(12), 'Moderate');
eq('rising', classifyTrend(15), 'Rising');
eq('rising upper', classifyTrend(20), 'Rising');
eq('steep', classifyTrend(25), 'Steep');

console.log('\ntrendConfidence:');
eq('HIGH', trendConfidence(16, 4), 'HIGH');
eq('MEDIUM', trendConfidence(8, 3), 'MEDIUM');
eq('LOW (few periods)', trendConfidence(16, 2), 'LOW');
eq('LOW (few samples)', trendConfidence(7, 3), 'LOW');

console.log('\nassembleCorpStats:');
// Singleton buckets must be dropped so one luxury sale can't fake a trend
// (real case from the dry-run: corp 2977 → fake +147% off a single $2.16/sqft sale).
eq(
  'singleton outlier → null',
  assembleCorpStats(
    [
      ['2024-H2', [0.8733]],
      ['2025-H1', [0.8744, 0.87, 0.88, 0.86, 0.89, 0.87, 0.88, 0.87]],
      ['2025-H2', [2.1575]],
    ],
    false
  ),
  null
);
eq(
  'too few total → null',
  assembleCorpStats(
    [
      ['2023-H1', [0.7, 0.71]],
      ['2023-H2', [0.72, 0.73]],
      ['2024-H1', [0.74, 0.75]],
    ],
    false
  ),
  null
);
const healthy = assembleCorpStats(
  [
    ['2023-H1', [0.7, 0.71, 0.72]],
    ['2023-H2', [0.74, 0.75, 0.76]],
    ['2024-H1', [0.79, 0.8, 0.81]],
  ],
  false
);
eq('healthy: buckets', healthy?.buckets.length, 3);
eq('healthy: sampleCount', healthy?.sampleCount, 9);
eq('healthy: band', classifyTrend(healthy ? healthy.pctChange24mo : 0), 'Rising');

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
  pctChange24mo: 15,
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
