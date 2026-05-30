// src/lib/avm/valueAdd/engine.ts
import type { AVMInput } from '../types';
import { Z_CLAMP, COEFFICIENT_ENGINE_THRESHOLD, HIGH_CONFIDENCE_THRESHOLD, BAND_MED } from '../types';
import type { AVMMarketData } from '../calculator';
import { clamp, FEATURE_SPECS } from '../features';
import { effectiveStd, MIN_COHORT_N, CEILING_STD, capValueAdd, featureGate } from './calibration';
import type { FeatureDelta, MoveSpec, ValueAddMove, SuppressReason } from './types';

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

function suppressed(move: MoveSpec, reason: SuppressReason): ValueAddMove {
  return {
    key: move.key, label: move.label, status: 'suppressed', suppressReason: reason,
    valueAddLow: 0, valueAddTyp: 0, valueAddHigh: 0,
    costLow: move.costLow, costTyp: move.costTyp, costHigh: move.costHigh,
    netGainTyp: 0, paybackRatio: 0, confidence: 'LOW',
  };
}

/**
 * Evaluate one move into a ValueAddMove. Runs the trust gauntlet:
 *  cohort gates (R², n) → per-driving-feature gates (beta sign, stub, null baseline,
 *  at-ceiling, already-present) → raw exp value → magnitude caps → range + confidence.
 */
export function evaluateMove(
  input: AVMInput,
  move: MoveSpec,
  market: AVMMarketData,
  subjectEstimate: number
): ValueAddMove {
  // Cohort gates
  if (market.r2 === null || market.r2 === undefined || market.r2 < COEFFICIENT_ENGINE_THRESHOLD) {
    return suppressed(move, 'low_r2');
  }
  if (market.n !== null && market.n !== undefined && market.n < MIN_COHORT_N) {
    return suppressed(move, 'thin_cohort');
  }

  const coeff = new Map(market.coefficients.map((c) => [c.featureName, c]));

  // Per-driving-feature gates
  for (const fname of move.drivingFeatures) {
    const c = coeff.get(fname);
    const gate = featureGate(c);
    if (gate) return suppressed(move, gate);
    const spec = FEATURE_SPECS.find((s) => s.name === fname)!;
    const v0 = spec.valueOf(input);
    if (v0 === null) return suppressed(move, 'null_baseline');
    if (v0 >= c!.mean + CEILING_STD * c!.std) return suppressed(move, 'at_ceiling');
  }

  // Already-present: a move that changes none of its driving features (e.g. basement
  // already finished) adds nothing.
  const after = applyMove(input, move.deltas);
  const changed = FEATURE_SPECS.some((s) => {
    if (!move.drivingFeatures.includes(s.name)) return false;
    const a = s.valueOf(input);
    const b = s.valueOf(after);
    return a !== null && b !== null && a !== b;
  });
  if (!changed) return suppressed(move, 'already_present');

  // Raw value → caps
  const raw = rawStackValue(input, after, market, subjectEstimate);
  const addedSqft = (after.buildingAreaTotal ?? 0) - (input.buildingAreaTotal ?? 0);
  const typ = Math.round(capValueAdd(raw, move, subjectEstimate, addedSqft));

  // Range from the cohort band; confidence from R² and band width.
  const sd = Number.isFinite(market.anchor.predSD) ? market.anchor.predSD : 0.1;
  const valueAddLow = Math.round(typ * Math.exp(-sd));
  const valueAddHigh = Math.round(typ * Math.exp(sd));
  let confidence: ValueAddMove['confidence'] =
    market.r2 >= HIGH_CONFIDENCE_THRESHOLD ? 'HIGH' : 'MEDIUM';
  if (sd >= BAND_MED) confidence = 'LOW';

  const netGainTyp = typ - move.costTyp;
  const paybackRatio = move.costTyp > 0 ? typ / move.costTyp : 0;

  return {
    key: move.key, label: move.label, status: 'priced',
    valueAddLow, valueAddTyp: typ, valueAddHigh,
    costLow: move.costLow, costTyp: move.costTyp, costHigh: move.costHigh,
    netGainTyp, paybackRatio, confidence,
  };
}
