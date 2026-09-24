import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Guards the hand-written INSERT in refreshRentalMarketIndex against the row shape it
 * persists.
 *
 * This exists because that lockstep broke in production. Migration 148 added
 * living_area_range to RentalIndexRow and to the cohort builder, but not to the INSERT —
 * so every size cohort was written with a NULL size, collided on the unique key, and the
 * TRUNCATE that runs first left rental_market_index EMPTY. Every rent estimate on the site
 * returned nothing until it was fixed.
 *
 * The source already carried a comment asking the reader to keep three things in lockstep
 * (COLS, the column list, the params.push). A comment is not a guard. This is.
 *
 * Source-text assertions are ugly, but the alternative is a live TRUNCATE to find out.
 *
 * It lives under scripts/worker/ rather than beside the script it guards because
 * vitest.config.ts excludes scripts/admin/** — a test placed next to the writer would never
 * run, which is a quieter version of the same failure.
 */
const SRC = fs.readFileSync(path.join(__dirname, '../admin/refreshRentalMarketIndex.ts'), 'utf8');

/** The column list inside `INSERT INTO rental_market_index ( ... ) VALUES`. */
function insertColumns(): string[] {
  const m = SRC.match(/INSERT INTO rental_market_index\s*\n?\s*\(([\s\S]*?)\)\s*\n?\s*VALUES/);
  if (!m) throw new Error('could not find the INSERT column list');
  return m[1].split(',').map((c) => c.trim()).filter(Boolean);
}

describe('refreshRentalMarketIndex writer', () => {
  it('declares COLS equal to the number of columns it inserts', () => {
    const cols = insertColumns();
    const declared = SRC.match(/const COLS = (\d+);/);
    expect(declared).not.toBeNull();
    expect(Number(declared![1])).toBe(cols.length);
  });

  it('pushes exactly one param per inserted column', () => {
    const cols = insertColumns();
    const push = SRC.match(/params\.push\(([\s\S]*?)\);/);
    expect(push).not.toBeNull();
    const pushed = push![1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(pushed).toHaveLength(cols.length);
  });

  it('persists every column the cohort builder sets, size included', () => {
    const cols = insertColumns();
    // The fields RentalIndexRow carries that must reach the table. living_area_range is
    // listed explicitly: leaving it out is the exact bug that emptied the index.
    for (const field of [
      'match_tier', 'basis', 'city_region', 'city', 'county', 'property_sub_type',
      'sub_type_family', 'bedrooms_total', 'bedrooms_above', 'den', 'bathrooms',
      'avg_rent', 'p10_rent', 'sample_count', 'living_area_range',
    ]) {
      expect(cols).toContain(field);
    }
  });

  it('reports cohort counts from the data, not a hardcoded tier list', () => {
    // A hardcoded list silently omitted the three size rungs, which reads to an operator
    // as "the new rungs did not build" on a run that was actually correct.
    expect(SRC).toMatch(/Object\.keys\(byTier\)/);
  });
});
