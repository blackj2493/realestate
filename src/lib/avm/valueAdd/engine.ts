// src/lib/avm/valueAdd/engine.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AVMInput } from '../types';
import { Z_CLAMP, COEFFICIENT_ENGINE_THRESHOLD, HIGH_CONFIDENCE_THRESHOLD, BAND_MED } from '../types';
import type { AVMMarketData } from '../calculator';
import { estimateFromMarketData } from '../calculator';
import { clamp, FEATURE_SPECS } from '../features';
import { fetchAnchor } from '../anchorService';
import { fetchAuditInfo } from '../auditService';
import { fetchCoefficients } from '../matrixService';
import { effectiveStd, MIN_COHORT_N, CEILING_STD, capValueAdd, featureGate, PCT_CAP_STACK, SCORE_K } from './calibration';
import { MOVE_CATALOG } from './moveCatalog';
import type { FeatureDelta, MoveSpec, ValueAddMove, SuppressReason, ValueAddReport, MoveKey } from './types';

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
    netGainTyp: 0, paybackRatio: 0, confidence: 'LOW', recommended: false,
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
    if (!c) return suppressed(move, 'placeholder');   // missing coeff row
    const gate = featureGate(c);
    if (gate) return suppressed(move, gate);
    const spec = FEATURE_SPECS.find((s) => s.name === fname)!;
    const v0 = spec.valueOf(input);
    if (v0 === null) return suppressed(move, 'null_baseline');
    const effStd = effectiveStd(fname, c.std);
    if (v0 >= c.mean + CEILING_STD * effStd) return suppressed(move, 'at_ceiling');
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
    netGainTyp, paybackRatio, confidence, recommended: false,
  };
}

const DISCLAIMER =
  'Modeled estimate from recent local sales — not an appraisal or guarantee. ' +
  'Actual returns vary by finish quality, permits, and market timing.';

function unavailableReport(input: AVMInput, _market: AVMMarketData): ValueAddReport {
  return {
    cityRegion: input.cityRegion,
    propertySubType: input.propertySubType,
    subjectEstimate: 0,
    headlineUpsideGross: 0,
    headlineUpside: 0,
    valueAddScore: 0,
    moves: MOVE_CATALOG.map((m) => suppressed(m, 'no_estimate')),
    neighbourhoodInsight: 'Not enough recent sales here to model renovation value yet.',
    basis: `${input.cityRegion} · ${input.propertySubType}`,
    disclaimer: DISCLAIMER,
  };
}

/** Deterministic, template-based insight from the cohort's value drivers (no AI). */
function neighbourhoodInsight(input: AVMInput, _market: AVMMarketData, moves: ValueAddMove[]): string {
  const priced = moves.filter((m) => m.status === 'priced');
  if (priced.length === 0) return `Renovation premiums in ${input.cityRegion} are hard to model from current sales.`;
  const top = priced.reduce((a, b) => (b.valueAddTyp > a.valueAddTyp ? b : a));
  const suppressedNeg = moves.find((m) => m.suppressReason === 'negative_beta');
  const tail = suppressedNeg ? ` ${suppressedNeg.label.toLowerCase()} adds little here.` : '';
  return `In ${input.cityRegion}, the market pays most for: ${top.label.toLowerCase()}.${tail}`;
}

export interface BuildValueAddOpts {
  /** Override P0 (the home's AVM estimate). The on-listing card passes the estimate
   *  already displayed so the report can never contradict it. Every move value is
   *  P0·(exp(Δ)−1), so this scales the whole report linearly. */
  subjectEstimate?: number;
}

export function buildValueAddReport(input: AVMInput, market: AVMMarketData, opts?: BuildValueAddOpts): ValueAddReport {
  const P0 =
    opts?.subjectEstimate && opts.subjectEstimate > 0
      ? opts.subjectEstimate
      : estimateFromMarketData(input, market).estimatedValue;
  if (P0 <= 0) return unavailableReport(input, market);

  const byKey = new Map<MoveKey, (typeof MOVE_CATALOG)[number]>(MOVE_CATALOG.map((m) => [m.key, m]));
  const moves = MOVE_CATALOG.map((m) => evaluateMove(input, m, market, P0)).sort(
    (a, b) => b.netGainTyp - a.netGainTyp
  );

  // Greedy non-overlapping selection of positive-payback priced moves for the headline.
  const claimed = new Set<string>();
  const selectedDeltas: FeatureDelta[] = [];
  const selected: ValueAddMove[] = [];
  for (const mv of moves) {
    if (mv.status !== 'priced' || mv.paybackRatio <= 1) continue;
    const spec = byKey.get(mv.key)!;
    const fields = spec.deltas.map((d) => d.field);
    if (fields.some((f) => claimed.has(f))) continue;
    fields.forEach((f) => claimed.add(f));
    selectedDeltas.push(...spec.deltas);
    selected.push(mv);
  }

  // Joint value-add via ONE re-eval over the union, capped by the stack %-cap.
  const after = applyMove(input, selectedDeltas);
  let jointValue = Math.max(0, rawStackValue(input, after, market, P0));
  jointValue = Math.min(jointValue, PCT_CAP_STACK * P0);
  const totalCost = selected.reduce((a, m) => a + m.costTyp, 0);
  const headlineUpsideGross = Math.max(0, Math.round(jointValue));
  const headlineUpside = Math.max(0, Math.round(jointValue - totalCost));
  const valueAddScore = Math.min(100, Math.round((jointValue / P0) * SCORE_K));

  return {
    cityRegion: input.cityRegion,
    propertySubType: input.propertySubType,
    subjectEstimate: P0,
    headlineUpsideGross,
    headlineUpside,
    valueAddScore,
    moves,
    neighbourhoodInsight: neighbourhoodInsight(input, market, moves),
    basis: `Based on ${market.n ?? 'recent'} ${input.cityRegion} ${input.propertySubType} sales`,
    disclaimer: DISCLAIMER,
  };
}

export interface FetchValueAddOpts {
  subjectEstimate?: number;
  /** Predictive SD already computed by calculateAVM (AVMResult.predictiveSD). When
   *  provided, skip the expensive anchor/comps query — the engine needs the anchor
   *  for predSD only. */
  predSD?: number;
}

/**
 * Async entry point: load this market's coefficients/audit/anchor (reusing the
 * AVM's prefixed-city_region-safe lookups), then build the pure report. The
 * value-add report does not need the peer comp-grid — at-ceiling homes are
 * suppressed by evaluateMove rather than peer-priced in Phase 1.
 *
 * Pass `opts.predSD` (from AVMResult.predictiveSD) to skip the anchor/comps
 * DB round-trip — the engine uses the anchor for predSD only, so the caller's
 * already-computed value is sufficient.
 */
export async function fetchValueAddReport(
  supabase: SupabaseClient,
  input: AVMInput,
  opts?: FetchValueAddOpts
): Promise<ValueAddReport> {
  const [coefficients, audit] = await Promise.all([
    fetchCoefficients(supabase, input.cityRegion, input.propertySubType),
    fetchAuditInfo(supabase, input.cityRegion, input.propertySubType),
  ]);
  const anchor =
    opts?.predSD !== undefined && Number.isFinite(opts.predSD)
      ? { anchorLevel: 0, predSD: opts.predSD, nEff: 0, comps: 0, basis: 'none' as const }
      : await fetchAnchor(supabase, input, coefficients, audit.basePrice);
  return buildValueAddReport(
    input,
    { anchor, r2: audit.r2, basePrice: audit.basePrice, coefficients, n: audit.n },
    { subjectEstimate: opts?.subjectEstimate }
  );
}
