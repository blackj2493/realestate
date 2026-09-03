/**
 * compSqft is the ONE definition of "how big is this sold comp", shared by the direct
 * raw_vow_sold read (anchorService.COMP_SELECT), both comp RPCs, the trend/offset
 * neutralizer, the trainer and the backtest harness.
 *
 * Two things have to hold, and only one of them is about the function:
 *
 *   1. The rule itself — exact area wins, the declared band is the fallback.
 *   2. Every reader must actually SUPPLY both columns. A source that fetches only
 *      building_area_total silently halves its own coverage, and a comp with no size is
 *      neutralized without its size term, so what made it big or small lands in the
 *      anchor. Migration 134 is the precedent for how quietly that fails: an RPC that
 *      did not RETURN a column shipped `undefined`, and nothing noticed until every comp
 *      from two rungs was being dropped.
 *
 * So the second half of this file reads the actual sources. It is a drift guard, not a
 * unit test, and it is deliberately dumb: if someone edits the SELECT or the migration
 * and drops the column, this fails in CI rather than in the anchor six weeks later.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { compSqft } from './features';
import { computeAnchorFromData, type CompRow } from './anchorService';
import type { CoefficientRow } from './matrixService';
import type { AVMInput } from './types';

describe('compSqft — the rule', () => {
  it('prefers an exact building_area_total', () => {
    expect(compSqft({ building_area_total: 2900, living_area_range: 2750 })).toBe(2900);
  });

  it('falls back to the declared band', () => {
    // 49,819 sale rows in the 36-month window are exactly this case. Reading the bare
    // column called every one of them "size unknown".
    expect(compSqft({ building_area_total: null, living_area_range: 2750 })).toBe(2750);
  });

  it('reports null only when the feed gave neither', () => {
    expect(compSqft({ building_area_total: null, living_area_range: null })).toBeNull();
    expect(compSqft({ building_area_total: null })).toBeNull();
  });

  it('treats a zero or absent value as missing, in either column', () => {
    // 0 sqft is a placeholder, not a home. It must not reach a log ratio.
    expect(compSqft({ building_area_total: 0, living_area_range: 1750 })).toBe(1750);
    expect(compSqft({ building_area_total: 0, living_area_range: 0 })).toBeNull();
    expect(compSqft({ building_area_total: null, living_area_range: undefined })).toBeNull();
  });
});

describe('compSqft — what it changes in the anchor', () => {
  const subject: AVMInput = {
    cityRegion: 'Vellore Village',
    city: 'Vaughan',
    propertySubType: 'Detached',
    rawPropertySubType: 'Detached',
    buildingAreaTotal: 2750,
    lotWidth: 40,
    bedroomsAboveGrade: 4,
    bedroomsBelowGrade: null,
    bathroomsTotalInteger: 4,
    parkingTotal: 4,
    interiorTier: 2,
    exteriorTier: 3,
    basementTier: 3,
    postalCode: 'L4H 3R9',
  };

  const coefficients: CoefficientRow[] = [
    { featureName: 'building_area_total', beta: 0.1039, mean: 2651.7, std: 840 },
  ];

  /** A band-only comp: exactly the third of the pool that used to reach the anchor sizeless. */
  const bandOnly = (price: number, date: string, band: number): CompRow =>
    ({
      close_price: price,
      purchase_contract_date: date,
      close_date: null,
      building_area_total: null,
      living_area_range: band,
      lot_width: 40,
      lot_depth: 105,
      bedrooms_above_grade: 4,
      bedrooms_below_grade: null,
      bathrooms_total_integer: 4,
      parking_total: 4,
      interior_tier: 2,
      exterior_tier: 3,
      basement_tier: 3,
      postal_code: 'L4H 1A1',
    }) as CompRow;

  const nowMs = Date.parse('2026-09-01T00:00:00Z');

  it('neutralizes a band-only comp for its size instead of skipping it', () => {
    // Two pools of identical sales. In one every comp is a 4,250 band home; in the other
    // the same prices came from 1,750 band homes. Once size is read, the big-home pool
    // neutralizes DOWN to a lower community level and the small-home pool neutralizes UP,
    // so the two anchors must differ. Before the coalesce both were sizeless and the two
    // pools were indistinguishable.
    const dates = ['2026-08-01', '2026-07-15', '2026-07-01', '2026-06-20'];
    const prices = [1_500_000, 1_520_000, 1_490_000, 1_510_000];
    const big = prices.map((p, i) => bandOnly(p, dates[i], 4250));
    const small = prices.map((p, i) => bandOnly(p, dates[i], 1750));

    const aBig = computeAnchorFromData(subject, coefficients, null, { comps: big, trend: [], offsets: [], nowMs });
    const aSmall = computeAnchorFromData(subject, coefficients, null, { comps: small, trend: [], offsets: [], nowMs });

    expect(aBig.basis).toBe('local');
    expect(aSmall.basis).toBe('local');
    expect(aBig.anchorLevel).not.toBeCloseTo(aSmall.anchorLevel, 4);
    // Same money, bigger homes → the per-sqft community level is LOWER.
    expect(aBig.anchorLevel).toBeLessThan(aSmall.anchorLevel);
  });

  it('still produces an anchor when neither column is filled', () => {
    const sizeless = [1_500_000, 1_520_000, 1_490_000, 1_510_000].map((p, i) => {
      const c = bandOnly(p, ['2026-08-01', '2026-07-15', '2026-07-01', '2026-06-20'][i], 0);
      return { ...c, living_area_range: null };
    });
    const a = computeAnchorFromData(subject, coefficients, null, { comps: sizeless, trend: [], offsets: [], nowMs });
    expect(a.basis).toBe('local');
    expect(Number.isFinite(a.anchorLevel)).toBe(true);
  });
});

describe('every comp source supplies both columns', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

  it('the direct raw_vow_sold read selects living_area_range', () => {
    const src = read('src/lib/avm/anchorService.ts');
    const select = src.slice(src.indexOf('const COMP_SELECT'), src.indexOf('const COMP_SELECT') + 400);
    expect(select).toContain('living_area_range');
    expect(select).toContain('building_area_total');
  });

  it('both comp RPCs return living_area_range', () => {
    const sql = read('supabase/migrations/136_sold_comp_rpcs_living_area_range.sql');
    for (const fn of ['sold_city_comps', 'sold_fsa_comps']) {
      const body = sql.slice(sql.indexOf(`CREATE FUNCTION public.${fn}`));
      const decl = body.slice(0, body.indexOf('$$;'));
      // Once in RETURNS TABLE, once in the SELECT list.
      expect(decl.match(/living_area_range/g)?.length).toBe(2);
    }
  });

  it('the trainer and the backtest harness fetch it too', () => {
    expect(read('scripts/worker/avm/trainMatrices.ts')).toContain('living_area_range::float8');
    expect(read('scripts/admin/avm-backtest.ts')).toContain('building_area_total, living_area_range,');
  });

  it('no reader re-implements the rule instead of calling compSqft', () => {
    // A second COALESCE anywhere is a second definition, and definitions drift. The
    // trainer used to have one; it now calls the helper like everyone else.
    for (const f of ['scripts/worker/avm/trainMatrices.ts', 'src/lib/avm/anchorService.ts', 'src/lib/avm/trendOffset.ts']) {
      expect(read(f)).not.toMatch(/COALESCE\(building_area_total/i);
    }
  });
});
