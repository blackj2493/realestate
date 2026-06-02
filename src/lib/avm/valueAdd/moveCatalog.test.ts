// src/lib/avm/valueAdd/moveCatalog.test.ts
import { describe, it, expect } from 'vitest';
import { MOVE_CATALOG } from './moveCatalog';
import { FEATURE_SPECS } from '../features';

describe('MOVE_CATALOG', () => {
  it('every move has costs, a positive cap, and ≥1 delta', () => {
    for (const m of MOVE_CATALOG) {
      expect(m.costTyp).toBeGreaterThan(0);
      expect(m.capHigh).toBeGreaterThan(0);
      expect(m.deltas.length).toBeGreaterThan(0);
    }
  });

  it('every delta field and driving feature is a real model feature', () => {
    const fields = new Set(FEATURE_SPECS.map((s) => s.inputField));
    const names = new Set(FEATURE_SPECS.map((s) => s.name));
    for (const m of MOVE_CATALOG) {
      for (const d of m.deltas) expect(fields.has(d.field)).toBe(true);
      for (const f of m.drivingFeatures) expect(names.has(f)).toBe(true);
    }
  });

  it('finish_basement raises the basement (sets a finished tier)', () => {
    const fb = MOVE_CATALOG.find((m) => m.key === 'finish_basement')!;
    expect(fb.deltas[0]).toEqual({ field: 'basementTier', op: 'set', value: 2 });
    expect(fb.drivingFeatures).toContain('basement_score');
  });
});
