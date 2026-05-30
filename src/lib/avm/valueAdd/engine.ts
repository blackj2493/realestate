// src/lib/avm/valueAdd/engine.ts
import type { AVMInput } from '../types';
import { Z_CLAMP } from '../types';
import type { AVMMarketData } from '../calculator';
import { clamp, FEATURE_SPECS } from '../features';
import { effectiveStd } from './calibration';
import type { FeatureDelta } from './types';

/** Apply a move's field deltas to a copy of the input (set = absolute, add = increment). */
export function applyMove(input: AVMInput, deltas: FeatureDelta[]): AVMInput {
  const next: AVMInput = { ...input };
  for (const d of deltas) {
    if (d.op === 'set') {
      (next[d.field] as number) = d.value;
    } else {
      const cur = (next[d.field] as number | null) ?? 0;
      (next[d.field] as number) = cur + d.value;
    }
  }
  return next;
}

/**
 * Marginal dollar value of moving from `input` to `after`, as the multiplicative
 * exp difference over the UNION of changed model features (one Σ → no double-count):
 *   ΔlogΣ = Σ_f β_f·(clamp(z1_f) − clamp(z0_f))     (count features use a floored std)
 *   value = P0 · (exp(ΔlogΣ) − 1)
 * P0 is the home's own AVM estimate. No ADJ_CLAMP here (per spec §6); saturation is
 * handled by the at-ceiling gate in evaluateMove.
 */
export function rawStackValue(
  input: AVMInput,
  after: AVMInput,
  market: AVMMarketData,
  subjectEstimate: number
): number {
  const coeff = new Map(market.coefficients.map((c) => [c.featureName, c]));
  let dLog = 0;
  for (const spec of FEATURE_SPECS) {
    const c = coeff.get(spec.name);
    if (!c || c.beta === 0 || !(c.std > 0)) continue;
    const v0 = spec.valueOf(input);
    const v1 = spec.valueOf(after);
    if (v0 === null || v1 === null || v0 === v1) continue;
    const std = effectiveStd(spec.name, c.std);
    const z0 = clamp((v0 - c.mean) / std, -Z_CLAMP, Z_CLAMP);
    const z1 = clamp((v1 - c.mean) / std, -Z_CLAMP, Z_CLAMP);
    dLog += c.beta * (z1 - z0);
  }
  return subjectEstimate * (Math.exp(dLog) - 1);
}
