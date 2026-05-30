import { describe, it, expect } from 'vitest';
import { buildCohortTree, normalizeCityRegion } from './cohorts';

const rows = [
  { city_region: 'Brampton West', property_sub_type: 'Detached', model_accuracy_score: 0.7, total_sales_analyzed: 117 },
  { city_region: 'Brampton West', property_sub_type: 'Townhouse', model_accuracy_score: 0.8, total_sales_analyzed: 90 },
  { city_region: '1001 - BR Bronte', property_sub_type: 'Detached', model_accuracy_score: 0.6, total_sales_analyzed: 50 },
  { city_region: 'Thin', property_sub_type: 'Detached', model_accuracy_score: 0.9, total_sales_analyzed: 10 },
  { city_region: 'LowR2', property_sub_type: 'Detached', model_accuracy_score: 0.3, total_sales_analyzed: 100 },
];
const pairs = [
  { city: 'Brampton', city_region: 'Brampton West' },
  { city: 'Oakville', city_region: '1001 - BR Bronte' },
];

describe('normalizeCityRegion', () => {
  it('strips legacy numeric/board prefixes for display only', () => {
    expect(normalizeCityRegion('1001 - BR Bronte')).toBe('Bronte');
    expect(normalizeCityRegion('Brampton West')).toBe('Brampton West');
  });
});

describe('buildCohortTree', () => {
  const tree = buildCohortTree(rows, pairs);
  it('drops low-R² and thin cohorts', () => {
    const s = JSON.stringify(tree);
    expect(s).not.toContain('Thin');
    expect(s).not.toContain('LowR2');
  });
  it('groups communities under parent city with display label + RAW key + sorted types', () => {
    expect(tree['Brampton']).toEqual([
      { community: 'Brampton West', cityRegion: 'Brampton West', types: ['Detached', 'Townhouse'] },
    ]);
    expect(tree['Oakville']).toEqual([
      { community: 'Bronte', cityRegion: '1001 - BR Bronte', types: ['Detached'] },
    ]);
  });
  it('returns {} for empty input', () => {
    expect(buildCohortTree([], [])).toEqual({});
  });
});
