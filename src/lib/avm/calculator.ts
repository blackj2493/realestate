/**
 * AVM Calculator — anchor-and-adjust over an interpretable standardized model.
 *
 *   estimate = anchor × exp( clamp( Σ beta_i · clamp((x_i − mean_i)/std_i, ±Z), ±ADJ ) )
 *
 * A typical home (every present feature at its market mean → all z=0) returns
 * exactly the anchor. Per-feature beta/mean/std come from the offline RidgeCV
 * fit (avm_multiplier_matrix); they are constants, so this is deterministic
 * arithmetic with no AI at request time (CLAUDE.md §4).
 *
 * Score conventions (must match the export + ingester):
 *   interior_score = 6 − interiorTier,  exterior_score = 5 − exteriorTier,
 *   basement_score = 10 − basementTier.
 *
 * Anchor: see anchorService.ts — de-staled, recency-weighted, robust + shrunk
 * local-level with a predictive SD. Replaces the old "≥5 90-day comps or
 * Base_Price fallback" gate; confidence is now derived from the band width,
 * not from a comp-count threshold.
 *
 * Gate: coefficient engine applies only when audit R² ≥ COEFFICIENT_ENGINE_THRESHOLD;
 * otherwise the result is anchor + band only.
 */

import type { AVMInput, AVMResult, AVMAdjustmentBreakdown, AnchorBasis, AvmTuning } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAnchor, fetchPeerAnchor, type AnchorResult } from './anchorService';
import { fetchCohortAudit, NO_AUDIT, type AuditInfo } from './auditService';
import { fetchCohortCoefficients, type CoefficientRow } from './matrixService';
import { fetchSiblingModel, clearsFallbackGate } from './siblingModel';
import { clamp, featureContributions, subjectAdjustmentTotal } from './features';
import { cohortRungLookupKeys, isUnpriceableType, type CohortRung } from './normalizeType';
import {
  ENGINE_MODE_COEFFICIENT_ADJUSTED,
  ENGINE_MODE_ANCHOR_ONLY,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  CONFIDENCE_LOW,
  COEFFICIENT_ENGINE_THRESHOLD,
  MIN_PEERS_FOR_HIGH,
  DEFAULT_TUNING,
} from './types';

/**
 * Pre-loaded per-market constants the estimate needs. Lets the request-time
 * path (calculateAVM) and the nightly batch precompute share ONE implementation
 * of the model math.
 */
export interface AVMMarketData {
  /** Anchor pipeline output: log-level + predictive SD + n_eff + basis. */
  anchor: AnchorResult;
  /** Model accuracy — gates the coefficient engine. */
  r2: number | null;
  /** Audit Base_Price — surfaced for legacy display; anchor service uses it as a fallback prior. */
  basePrice: number | null;
  /** Cohort sample size (avm_audit_report.total_sales_analyzed). Used by the
   * valueAdd engine to suppress thin cohorts; the AVM estimate ignores it. */
  n?: number | null;
  /** Per-feature standardized coefficients (beta/mean/std) for this market. */
  coefficients: CoefficientRow[];
  /**
   * Coefficients from a cohort COARSER than the community — the postal FSA or the whole
   * city (migration 130) — for a subject whose community has no trained model. They
   * drive the feature ADJUSTMENT only. `coefficients` stays EMPTY for such a subject, so
   * it still ROUTES as untrained: peers are always evaluated, the floor branch publishes
   * instead of suppressing, and no path reaches HIGH.
   *
   * WHY THE SPLIT. #452 let a coarse cohort route as TRAINED — the same rows in
   * `coefficients` — and the probe measured 25% of Waterloo Region + Brantford
   * suppressed on the floor branch and 25 of 40 listings MEDIUM → LOW (#458). Having
   * coefficients is not the same thing as being a trained community.
   */
  coarseCoefficients?: CoefficientRow[];
  /**
   * Peer comp-grid anchor for SATURATING outliers (CLAUDE.md §10). Supplied by the
   * async layer ONLY when isSaturating() is true:
   *   • AnchorResult → price the subject off homes like it (basis 'peer');
   *   • null         → saturating but too few peers → keep the clamped number as a
   *                    neighbourhood FLOOR with capped confidence (basis 'floor');
   *   • undefined    → not evaluated → the normal clamp path runs unchanged.
   * Honored only when the clamp actually binds, so non-saturating homes are frozen.
   */
  peer?: AnchorResult | null;
}

/**
 * True when the cohort model implies a feature premium beyond the ±ADJ_CLAMP
 * clamp — the subject is a feature-space outlier the standard estimate cannot
 * price (the clamp distorts it when the engine is on; anchor-only mode ignores it
 * entirely). ENGINE-INDEPENDENT BY DESIGN: low-R² (anchor-only) cohorts are
 * exactly where a large home silently sits at the neighbourhood level, so this
 * must NOT gate on R². The sole trigger for the peer comp-grid; for every typical
 * home the implied premium is within the clamp and the estimate is unchanged.
 */
export function isFeatureOutlier(
  input: AVMInput,
  coefficients: CoefficientRow[],
  tuning: AvmTuning = DEFAULT_TUNING
): boolean {
  if (coefficients.length === 0) return false; // can't assess without a model
  const coeff = new Map(coefficients.map((c) => [c.featureName, c]));
  return Math.abs(subjectAdjustmentTotal(input, coeff)) > tuning.peerTrigger;
}

/**
 * Single source of truth for whether to pull peer comps: trained cohorts gate on
 * the Σβz clamp-saturation signal; untrained cohorts (no coefficients) always
 * evaluate peers so every home gets feature/size-matched comps rather than a blind
 * cohort average. Shared by the request path and the nightly batch so they can't drift.
 */
export function shouldEvaluatePeers(
  input: AVMInput,
  coefficients: CoefficientRow[],
  tuning: AvmTuning = DEFAULT_TUNING
): boolean {
  return coefficients.length > 0
    ? isFeatureOutlier(input, coefficients, tuning) // trained: only trigger-saturating outliers
    : true;                                         // untrained: ALWAYS match comps (no blind average)
}

/**
 * Resolved model for a single listing: walks the cohort ladder (community → postal FSA
 * → city, normalizeType.cohortRungLookupKeys) for coefficients + audit, then borrows the
 * best trained sibling when no rung has a model.
 *
 * This is the SINGLE SOURCE OF TRUTH for the ladder+borrow+decouple logic. The
 * request-time path (calculateAVM), the nightly batch precompute
 * (refresh-property-estimates) and the backtest call it so they can never diverge.
 *
 *   nativeCoefficients  — drive ROUTING (empty ⟺ untrained, always evaluates peers).
 *                         Only the COMMUNITY rung fills this.
 *   effectiveCoefficients — drive ADJUSTMENT (= coarse rung's, sibling's, or native)
 *   r2 / basePrice / n  — from the audit row of the rung that answered; sibling's when borrowed
 *   borrowed            — true when a sibling's model was substituted
 *   rung                — which rung supplied effectiveCoefficients: 'community' (trained),
 *                         'fsa' | 'city' (coarse — routes as untrained, see
 *                         AVMMarketData.coarseCoefficients), null (sibling or no model)
 */
export interface ResolvedModel {
  nativeCoefficients: CoefficientRow[];
  effectiveCoefficients: CoefficientRow[];
  r2: number | null;
  basePrice: number | null;
  n: number | null | undefined;
  borrowed: boolean;
  rung: CohortRung | null;
}

export async function resolveModel(
  supabase: SupabaseClient,
  input: Pick<AVMInput, 'cityRegion' | 'propertySubType' | 'city' | 'rawPropertySubType' | 'postalCode'>
): Promise<ResolvedModel> {
  // Both lookups walk the SAME ladder and return every rung that answered, so the audit
  // read for a rung always describes the cohort its coefficients came from. The trainer
  // writes the matrix row and the audit row together, so a rung present in one is
  // present in the other.
  const rungs = cohortRungLookupKeys(input.cityRegion, input.postalCode, input.city);
  const [models, audits] = await Promise.all([
    fetchCohortCoefficients(supabase, rungs, input.propertySubType),
    fetchCohortAudit(supabase, rungs, input.propertySubType),
  ]);
  const auditOf = (rung: CohortRung): AuditInfo => audits.find((a) => a.rung === rung) ?? NO_AUDIT;

  for (const model of models) {
    const audit = auditOf(model.rung);

    // The community's own model: trained, whatever its R² (the engine gate handles that).
    if (model.rung === 'community') {
      return {
        nativeCoefficients: model.rows,
        effectiveCoefficients: model.rows,
        r2: audit.r2,
        basePrice: audit.basePrice,
        n: audit.n,
        borrowed: false,
        rung: 'community',
      };
    }

    // A coarse rung: the subject's OWN market, one or two resolutions up. It stands in for
    // the untrained community only if it clears the bar a sibling must clear — a weak fit
    // is skipped for the next rung, exactly as pickSibling skips a weak sibling. Its
    // coefficients adjust; nothing here routes, so nativeCoefficients stays empty.
    if (clearsFallbackGate(audit.r2, audit.n)) {
      return {
        nativeCoefficients: [],
        effectiveCoefficients: model.rows,
        r2: audit.r2,
        basePrice: audit.basePrice,
        n: audit.n,
        borrowed: false,
        rung: model.rung,
      };
    }
  }

  // No usable rung. Only the community audit row is kept from here on — exactly what the
  // pre-ladder lookup returned — so an unused coarse rung's r2 can never switch the
  // engine on, and its Base_Price never becomes the anchor's prior.
  const audit = auditOf('community');
  const sibling = await fetchSiblingModel(supabase, input.city, input.propertySubType, input.rawPropertySubType);
  if (sibling) {
    return {
      nativeCoefficients: [],
      effectiveCoefficients: sibling.coefficients,
      r2: sibling.r2,
      basePrice: audit.basePrice,
      n: sibling.n,
      borrowed: true,
      rung: null,
    };
  }

  return {
    nativeCoefficients: [],
    effectiveCoefficients: [],
    r2: audit.r2,
    basePrice: audit.basePrice,
    n: audit.n,
    borrowed: false,
    rung: null,
  };
}

/**
 * The static half of AVMMarketData for a resolved model — the ONE place that decides
 * which coefficients ROUTE (native) and which coarse ones ADJUST. Every caller that
 * resolves a model and then calls estimateFromMarketData spreads this in, so the
 * request path, the nightly batch and the backtest cannot disagree about it.
 */
export function marketDataOf(
  model: ResolvedModel
): Pick<AVMMarketData, 'r2' | 'basePrice' | 'n' | 'coefficients' | 'coarseCoefficients'> {
  return {
    r2: model.r2,
    basePrice: model.basePrice,
    n: model.n,
    coefficients: model.nativeCoefficients, // NATIVE: keeps outlierGuard on the untrained→peer path
    coarseCoefficients:
      model.rung === 'fsa' || model.rung === 'city' ? model.effectiveCoefficients : undefined,
  };
}

export async function calculateAVM(
  supabase: SupabaseClient,
  input: AVMInput
): Promise<AVMResult> {
  const model = await resolveModel(supabase, input);
  const { nativeCoefficients, effectiveCoefficients, basePrice, borrowed } = model;

  // EFFECTIVE (coarse-rung or borrowed) coefficients drive comp ADJUSTMENT.
  const anchor = await fetchAnchor(supabase, input, effectiveCoefficients, basePrice);

  // Peer comp-grid for the homes the standard estimate mis-prices. undefined →
  // not evaluated → normal path unchanged; AnchorResult → peer-grid; null → too
  // few peers → neighbourhood floor. ROUTING gates on NATIVE coefficients so an
  // untrained cohort always evaluates peers regardless of whether we borrowed.
  let peer: AnchorResult | null | undefined;
  if (shouldEvaluatePeers(input, nativeCoefficients)) {
    peer = await fetchPeerAnchor(supabase, input, effectiveCoefficients);
    if (peer && borrowed) peer.basis = 'borrowed';
  }

  return estimateFromMarketData(input, { anchor, peer, ...marketDataOf(model) });
}

/**
 * Pure, deterministic estimate from a listing's features + pre-loaded market
 * data. Identical inputs always yield an identical result; no I/O, no AI.
 */
export function estimateFromMarketData(
  input: AVMInput,
  market: AVMMarketData,
  tuning: AvmTuning = DEFAULT_TUNING
): AVMResult {
  const { anchor } = market;

  // Anchor unavailable: render "estimate unavailable" downstream.
  if (anchor.basis === 'none' || !Number.isFinite(anchor.anchorLevel)) {
    return unavailable(market);
  }

  // Unpriceable types (Vacant Land/Farm/Mobile/Triplex/…) are out-of-distribution for
  // the dwelling comp model — an honest "unavailable" beats a 40–70%-off number. (Link,
  // Duplex, Modular stay published — they price fine.)
  if (tuning.suppressExotic && isUnpriceableType(input.rawPropertySubType || input.propertySubType)) {
    return unavailable(market);
  }

  // Peer/floor branch — engine-independent, so it sits ABOVE the R² gate. Honored
  // only when the async layer evaluated peers (market.peer !== undefined). For
  // TRAINED cohorts we re-verify the home is a Σβz outlier (defense in depth, so a
  // stray peer can't move a typical home); for UNTRAINED cohorts (no coefficients,
  // no Σβz signal) we trust the async layer's market-relative decision. The golden
  // master proves the normal path (peer undefined) is frozen either way.
  const outlierGuard =
    market.coefficients.length > 0 ? isFeatureOutlier(input, market.coefficients, tuning) : true;
  if (market.peer !== undefined && outlierGuard) {
    if (market.peer) return peerEstimate(market.peer, market.r2, market.coefficients.length === 0, tuning);
    // peer === null → too few peers anywhere. For TRAINED cohorts the home is a
    // Σβz saturating outlier → 'floor' honestly labels "clamped number, too few peers".
    // For UNTRAINED cohorts the home isn't necessarily large/upgraded — there just
    // aren't enough comps — so keep the anchor's own honest basis and cap confidence.
    const base = normalEstimate(input, market, tuning);
    if (base.estimatedValue <= 0) return base; // already suppressed → leave as-is
    const untrained = market.coefficients.length === 0;
    // TRAINED 'floor' is a saturating outlier shown at a clamped neighbourhood number —
    // a known severe under-estimate. Suppressing is more honest than publishing it low.
    if (tuning.suppressFloor && !untrained) return unavailable(market);
    // COARSE cohort with too few peers: the coarse model can at least say whether the
    // home is an outlier. When it is, `base` is the same clamped extrapolation a trained
    // floor would show — an $8.8M Woolwich home priced at 2.5× the FSA's typical — so
    // label it 'floor' and publish LOW: honest about the number, and LOW already keeps
    // it out of every competition signal. Not suppressed, because a coarse rung is a
    // fallback and coverage must not fall below what the untrained path published.
    if (
      untrained &&
      market.coarseCoefficients &&
      market.coarseCoefficients.length > 0 &&
      isFeatureOutlier(input, market.coarseCoefficients, tuning)
    ) {
      return { ...base, basis: 'floor', confidence: CONFIDENCE_LOW };
    }
    return {
      ...base,
      basis: untrained ? base.basis : 'floor',
      confidence: base.confidence === CONFIDENCE_HIGH ? CONFIDENCE_MEDIUM : base.confidence,
    };
  }

  return normalEstimate(input, market, tuning);
}

/** Coefficient engine when R² clears the gate AND a model of the subject's own market is present, else anchor-only. */
function normalEstimate(input: AVMInput, market: AVMMarketData, tuning: AvmTuning = DEFAULT_TUNING): AVMResult {
  const { anchor } = market;
  const baseAnchor = Math.exp(anchor.anchorLevel);

  // Native coefficients adjust a trained cohort. Coarse coefficients adjust an untrained
  // one whose FSA or city has a model — fitted on the subject's own market, unlike a
  // borrowed sibling's, which never reach here (the r2 may be the sibling's, but without
  // a model of THIS market we cannot compute Σβz for the subject). A coarse-rung estimate
  // never earns HIGH, the same rule the peer and floor paths apply to untrained cohorts.
  const coarse = market.coefficients.length === 0 && (market.coarseCoefficients?.length ?? 0) > 0;
  const adjusting = coarse ? market.coarseCoefficients! : market.coefficients;
  if (market.r2 !== null && market.r2 >= COEFFICIENT_ENGINE_THRESHOLD && adjusting.length > 0) {
    return calculateWithCoefficients(baseAnchor, anchor, market.r2, input, adjusting, coarse, tuning);
  }

  // Anchor-only: estimate = anchor; band derived directly from predSD.
  return finish({
    estimatedValue: Math.round(baseAnchor),
    anchorPrice: Math.round(baseAnchor),
    totalAdjustmentPct: 0,
    engineMode: ENGINE_MODE_ANCHOR_ONLY,
    r2Score: market.r2,
    breakdown: blankBreakdown(),
    adjustmentLog: 0,
    anchor,
  }, coarse ? { capHigh: true } : undefined, tuning);
}

/**
 * Price the subject off the peer comp-grid (basis 'peer' or 'borrowed'); HIGH gated on peer count and basis.
 * @param capHigh - when true, demote HIGH→MEDIUM regardless of band/peer count.
 *   Callers pass `true` for ANY untrained cohort (empty native coefficients), not just
 *   borrowed-basis: an untrained estimate — whether it borrowed a sibling model or
 *   found peers with no model at all — must never be labelled HIGH.
 */
function peerEstimate(peer: AnchorResult, r2Score: number | null, capHigh = false, tuning: AvmTuning = DEFAULT_TUNING): AVMResult {
  const peerPrice = Math.exp(peer.anchorLevel);
  return finish(
    {
      estimatedValue: Math.round(peerPrice),
      anchorPrice: Math.round(peerPrice),
      totalAdjustmentPct: 0,
      engineMode: ENGINE_MODE_COEFFICIENT_ADJUSTED,
      r2Score,
      breakdown: blankBreakdown(),
      adjustmentLog: 0,
      anchor: peer, // basis 'peer'/'borrowed', band from peer dispersion
    },
    {
      minPeersForHigh: MIN_PEERS_FOR_HIGH,
      effectivePeers: peer.nEff,
      // Belt-and-suspenders: cap for borrowed basis AND for any untrained cohort (no
      // native coefficients), so no path through peerEstimate can label an untrained
      // result HIGH regardless of how the peer was sourced.
      capHigh: peer.basis === 'borrowed' || capHigh,
    },
    tuning
  );
}

function calculateWithCoefficients(
  baseAnchor: number,
  anchor: AnchorResult,
  r2Score: number,
  input: AVMInput,
  coefficients: CoefficientRow[],
  /** Coarser-than-community cohort: demote HIGH, see AVMMarketData.coarseCoefficients. */
  capHigh = false,
  tuning: AvmTuning = DEFAULT_TUNING
): AVMResult {
  const coeff = new Map(coefficients.map((c) => [c.featureName, c]));

  const breakdown = blankBreakdown();
  let rawTotal = 0;
  for (const c of featureContributions(input, coeff)) {
    rawTotal += c.contribution;
    breakdown[c.key] = Math.round(baseAnchor * c.contribution);
  }

  const total = clamp(rawTotal, -tuning.adjClamp, tuning.adjClamp);
  const estimatedValue = Math.round(baseAnchor * Math.exp(total));

  return finish({
    estimatedValue,
    anchorPrice: Math.round(baseAnchor),
    totalAdjustmentPct: Math.exp(total) - 1,
    engineMode: ENGINE_MODE_COEFFICIENT_ADJUSTED,
    r2Score,
    breakdown,
    adjustmentLog: total,
    anchor,
  }, capHigh ? { capHigh } : undefined, tuning);
}

/**
 * Apply the symmetric log-space band to the point estimate and derive confidence
 * from its relative half-width. SUPPRESS the estimate entirely when the band is
 * wider than BAND_LOW — we don't publish a number we can't stand behind.
 */
function finish(
  args: {
    estimatedValue: number;
    anchorPrice: number;
    totalAdjustmentPct: number;
    engineMode: AVMResult['engineMode'];
    r2Score: number | null;
    breakdown: AVMAdjustmentBreakdown;
    adjustmentLog: number; // total adjustment in log-space (already clamped)
    anchor: AnchorResult;
  },
  opts?: {
    /** Peer mode: forbid HIGH unless effectivePeers ≥ minPeersForHigh. */
    minPeersForHigh?: number;
    effectivePeers?: number;
    /** Untrained/borrowed: never publish HIGH (a community-borrowed number isn't HIGH). */
    capHigh?: boolean;
  },
  tuning: AvmTuning = DEFAULT_TUNING
): AVMResult {
  const { anchor, adjustmentLog } = args;

  // Band on price: exp(level ± SD) × exp(feature adjustment).
  const lowBand = Math.round(Math.exp(anchor.anchorLevel - anchor.predSD + adjustmentLog));
  const highBand = Math.round(Math.exp(anchor.anchorLevel + anchor.predSD + adjustmentLog));

  // Relative half-width on price ≈ predSD itself in log-space (1-σ band).
  const relHalfWidth = anchor.predSD;
  let confidence: AVMResult['confidence'];
  let estimatedValue = args.estimatedValue;
  let basis: AnchorBasis = anchor.basis;

  if (!Number.isFinite(relHalfWidth) || relHalfWidth > tuning.bandLow) {
    // Range too wide to publish — degrade to "unavailable" without erasing the
    // anchor/band (caller can still surface diagnostics).
    confidence = CONFIDENCE_LOW;
    estimatedValue = 0;
    basis = 'none';
  } else {
    if (relHalfWidth < tuning.bandHigh) {
      confidence = CONFIDENCE_HIGH;
    } else if (relHalfWidth < tuning.bandMed) {
      confidence = CONFIDENCE_MEDIUM;
    } else {
      confidence = CONFIDENCE_LOW;
    }
    // A tight band over too few peers is not HIGH — demote it.
    if (
      confidence === CONFIDENCE_HIGH &&
      opts?.minPeersForHigh !== undefined &&
      (opts.effectivePeers ?? 0) < opts.minPeersForHigh
    ) {
      confidence = CONFIDENCE_MEDIUM;
    }
    // A borrowed-basis estimate (untrained cohort, sibling coefficients) is never HIGH.
    if (confidence === CONFIDENCE_HIGH && opts?.capHigh) {
      confidence = CONFIDENCE_MEDIUM;
    }
  }

  return {
    estimatedValue,
    anchorPrice: args.anchorPrice,
    totalAdjustmentPct: args.totalAdjustmentPct,
    engineMode: args.engineMode,
    r2Score: args.r2Score,
    breakdown: args.breakdown,
    confidence,
    comps: anchor.comps,
    nEff: Math.round(anchor.nEff * 100) / 100,
    basis,
    lowBand: estimatedValue > 0 ? lowBand : 0,
    highBand: estimatedValue > 0 ? highBand : 0,
    predictiveSD: relHalfWidth,
  };
}

function unavailable(market: AVMMarketData): AVMResult {
  return {
    estimatedValue: 0,
    anchorPrice: 0,
    totalAdjustmentPct: 0,
    engineMode: ENGINE_MODE_ANCHOR_ONLY,
    r2Score: market.r2,
    breakdown: blankBreakdown(),
    confidence: CONFIDENCE_LOW,
    comps: market.anchor.comps,
    nEff: 0,
    basis: 'none',
    lowBand: 0,
    highBand: 0,
    predictiveSD: Infinity,
  };
}

function blankBreakdown(): AVMAdjustmentBreakdown {
  return {
    buildingAreaAdjustment: 0,
    lotWidthAdjustment: 0,
    bedroomsAdjustment: 0,
    plusRoomAdjustment: 0,
    bathroomsAdjustment: 0,
    parkingAdjustment: 0,
    interiorAdjustment: 0,
    exteriorAdjustment: 0,
    basementAdjustment: 0,
  };
}
