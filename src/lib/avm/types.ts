/**
 * AVM Types — Anchor and Adjust Automated Valuation Model
 *
 * Terminology: The word "AI" is banned from all code, variable names,
 * function names, API responses, and comments.
 *
 * Counts and the two continuous features are `number | null`: null means the
 * field is genuinely ABSENT on the listing and the calculator skips it (which
 * matches the training pipeline imputing a missing value with the feature mean →
 * standardizes to z=0). A real `0` (e.g. 0 parking) is kept and standardized.
 */

export interface AVMInput {
  cityRegion: string;
  /** Municipality (raw_vow_sold.city / payload.City) — used for city-level
   * trend de-staling. Optional: when missing, anchor falls back to using
   * cityRegion as the trend-lookup group. */
  city: string | null;
  /** Canonical type for matrix/audit lookups (normalizePropertySubType output). */
  propertySubType: string;
  /** Verbatim listing PropertySubType — used to pool raw_vow_sold anchor variants. */
  rawPropertySubType: string;
  buildingAreaTotal: number | null;
  lotWidth: number | null;
  /** Lot depth (ft). Used ONLY for peer similarity in the comp-grid (not a trained
   * coefficient), so adding it never changes the normal-path estimate. Optional. */
  lotDepth?: number | null;
  bedroomsAboveGrade: number | null;
  bathroomsTotalInteger: number | null;
  parkingTotal: number | null;
  interiorTier: number; // 1-5
  exteriorTier: number; // 1-5
  basementTier: number; // 1-9
  /** Full 6-char postal code (payload.PostalCode). Used ONLY for hierarchical
   * geographic comp weighting (same building/block > FSA > community); never a
   * trained coefficient. Optional — when absent, geo weights are all 1.0 (no-op). */
  postalCode?: string | null;
}

/** Where the anchor's level estimate came from — surfaced in the UI basis line. */
export type AnchorBasis =
  | 'local'   // recent local comps drove the level (low shrinkage to prior)
  | 'blend'   // local comps + de-staled prior shrunk together
  | 'prior'   // no usable local comps; prior (g(t₀)+δ_c) carried the level
  | 'parent'  // community offset missing; parent city × sub-type level used
  | 'borrowed'// untrained cohort priced via matched comps + a trained SIBLING cohort's coefficients
  | 'peer'    // saturating outlier priced by the peer comp-grid (homes like it)
  | 'floor'   // saturating outlier, too few peers — clamped number as a neighbourhood FLOOR
  | 'none';   // truly nothing — render "estimate unavailable"

export interface AVMResult {
  estimatedValue: number;
  anchorPrice: number;
  totalAdjustmentPct: number;
  engineMode: 'COEFFICIENT_ADJUSTED' | 'ANCHOR_ONLY';
  r2Score: number | null;
  breakdown: AVMAdjustmentBreakdown;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';

  /** Number of raw recent comps consulted (pre-Huber weighting). */
  comps: number;
  /** Kish-effective sample size (Σw)² / Σw² after recency + robust weights. */
  nEff: number;
  /** Which leg of the anchor pipeline produced the level. */
  basis: AnchorBasis;
  /** Lower bound of the 1-SD predictive band on price (= exp(level - SD) × feature multiplier). */
  lowBand: number;
  /** Upper bound of the 1-SD predictive band on price. */
  highBand: number;
  /** Predictive SD in log-space (combined local + prior variance). */
  predictiveSD: number;
}

export interface AVMAdjustmentBreakdown {
  buildingAreaAdjustment: number;
  lotWidthAdjustment: number;
  bedroomsAdjustment: number;
  bathroomsAdjustment: number;
  parkingAdjustment: number;
  interiorAdjustment: number;
  exteriorAdjustment: number;
  basementAdjustment: number;
}

/**
 * Engine mode constants
 */
export const ENGINE_MODE_COEFFICIENT_ADJUSTED = 'COEFFICIENT_ADJUSTED' as const;
export const ENGINE_MODE_ANCHOR_ONLY = 'ANCHOR_ONLY' as const;

/**
 * Confidence level constants
 */
export const CONFIDENCE_HIGH = 'HIGH' as const;
export const CONFIDENCE_MEDIUM = 'MEDIUM' as const;
export const CONFIDENCE_LOW = 'LOW' as const;

/**
 * Coefficient engine gate (R² >= 0.50) and high-confidence threshold (R² >= 0.70).
 */
export const COEFFICIENT_ENGINE_THRESHOLD = 0.5;
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Standardized log-space formula bounds.
 *   z_i      = clamp((x_i − mean_i) / std_i, ±Z_CLAMP)
 *   total    = clamp(Σ beta_i · z_i, ±ADJ_CLAMP)
 *   estimate = anchor × exp(total)
 */
export const Z_CLAMP = 3;
export const ADJ_CLAMP = 0.4;

/**
 * Anchor-pipeline tuning. Defaults shipped Phase 1; Phase 2 will fit them via
 * cross-validation against raw_vow_sold (see plan concurrent-prancing-owl).
 *
 *   H_DAYS    — exponential recency half-life on comp weights (~4 mo).
 *   TAU2      — between-community variance in log-space (prior strength).
 *   SIGMA2    — residual variance per comp (Kish-effective denominator).
 *   COMP_WINDOW_MO — trailing months of comps to consider local.
 *   HUBER_K   — Huber threshold (std-units) on the comp ℓ residual.
 *   BAND_*    — relative half-width thresholds for confidence; above BAND_LOW,
 *               suppress the estimate ("range too wide to publish").
 */
export const H_DAYS = 120;
export const TAU2 = 0.02;
export const SIGMA2 = 0.04;
export const COMP_WINDOW_MO = 12;
export const HUBER_K = 1.345;
export const BAND_HIGH = 0.08;
export const BAND_MED = 0.15;
export const BAND_LOW = 0.25;

/**
 * Peer comp-grid tuning (atypical / high-end homes). Fires only when the standard
 * coefficient adjustment saturates the ±ADJ_CLAMP clamp — see calculator.isSaturating.
 * Stays independent of list price (CLAUDE.md §2).
 *
 *   MIN_PEER_NEFF       — effective peers a geography rung must clear to anchor on
 *                         peers; below it, escalate, then fall back to a FLOOR.
 *   MIN_PEERS_FOR_HIGH  — effective peers required before a peer estimate may be
 *                         labelled HIGH confidence (a tight band on 3 comps isn't HIGH).
 *   BW_*                — Gaussian similarity bandwidths (std-units) on the size
 *                         proxies the comps actually carry: beds, baths, log-lot-area.
 * Phase-1 defaults; tune against raw_vow_sold like the anchor-pipeline constants.
 */
export const MIN_PEER_NEFF = 6;
export const MIN_PEERS_FOR_HIGH = 8;
export const BW_BEDS = 1;
export const BW_BATHS = 1;
export const BW_LOT = 0.5;
/** Gaussian bandwidth (log-space) for sqft similarity. Subject sqft is the resolved
 * room-sum; comp sqft is the 500-sqft bucket midpoint, so resolution is coarse —
 * this mainly separates size CLASSES (e.g. ~2,250 vs ~4,250). Tunable. */
export const BW_SQFT = 0.25;

/**
 * Coefficient-free outlier gate for UNTRAINED cohorts (no matrix row → anchor-only,
 * e.g. Scarborough Village). With no betas we can't compute Σβz, so we flag a home
 * as atypical when it sits more than this many std-devs from its local comp
 * distribution on a size proxy (beds-above-grade, baths, log lot width). Market-
 * relative, list-price-independent. Phase-1 default; tunable.
 */
export const OUTLIER_Z = 1.5;

/**
 * Minimum close_price for a row to count as a SALE comp. raw_vow_sold mixes sold
 * records with LEASED ones (close_price = monthly rent, e.g. $3,250); there is no
 * scalar transaction_type to filter on. Residential rents never approach this, so
 * the floor cleanly excludes leases without dropping legitimate low-end sales. Tunable.
 */
export const MIN_SALE_PRICE = 50_000;

/**
 * Tunable knobs for the estimate math, injectable so the backtest harness can A/B
 * variants without touching production. `DEFAULT_TUNING` reproduces the historical
 * constants EXACTLY, so any call site that omits `tuning` is byte-identical to before.
 *
 *   predMode 'legacy'      — predSD = estimation SD only (a CONFIDENCE interval for the
 *                            mean level; collapses to ~4% → bands cover only ~18%).
 *   predMode 'predictive'  — predSD = sqrt(estimationVar + compDispersion²); a true
 *                            PREDICTION interval for THIS home that includes the
 *                            irreducible spread of comparable sales (covers ~68%) and
 *                            auto-widens for dispersed/atypical cohorts. The comp
 *                            dispersion is the robust SD already computed from comps —
 *                            100% as-of, no future data, leakage-safe.
 *   adjClamp               — ± log-space cap on the subject feature adjustment.
 *   peerTrigger            — |Σβz| above which a home routes to the peer comp-grid.
 *                            Decoupled from adjClamp so we can route MORE homes to the
 *                            (well-calibrated) peer grid without loosening the clamp.
 *   band{High,Med,Low}     — predSD thresholds for HIGH/MEDIUM/LOW; above bandLow the
 *                            estimate is suppressed. Recalibrated for predictive predSD.
 *   priorSd                — predSD when there are no local comps (prior-only / no-comp).
 */
export interface AvmTuning {
  predMode: 'legacy' | 'predictive';
  adjClamp: number;
  peerTrigger: number;
  bandHigh: number;
  bandMed: number;
  bandLow: number;
  priorSd: number;
  /** Between-community prior variance — the shrinkage strength (wPrior = 1/tau2).
   *  Higher tau2 = weaker prior = more weight on local comps. */
  tau2: number;
  /** Optional nEff-adaptive prior variance: as local comps accumulate, trust them
   *  more (weaken the prior). null → flat `tau2`. Defends sparse cohorts (small nEff
   *  keeps the strong prior) while letting comp-rich expensive cohorts escape the
   *  pull to the community median (the -36% @ 2M+ bias). */
  tau2Schedule: { ltN: number; lt: number; geN: number; ge: number } | null;
  /** Suppress (publish no number) for the 'floor' basis — a saturating outlier with
   *  too few peers, whose clamped neighbourhood number is a known severe under-estimate
   *  (−42% to −77% bias). An honest "estimate unavailable" beats a confidently-low number. */
  suppressFloor: boolean;
  /** Suppress for non-canonical (exotic) property types — Vacant Land/Farm/Mobile/
   *  Triplex/etc. — which the 4-type dwelling model prices very poorly (41–67% error). */
  suppressExotic: boolean;
  /** Hierarchical geographic comp weights (multiplicative upweight of nearby comps;
   *  1.0 = off). A comp sharing the subject's full 6-char postal (same building/block)
   *  gets ×geoFull; same FSA+LDU1 (block cluster) ×geoBlock; same FSA (neighbourhood)
   *  ×geoFsa; elsewhere in the community ×1.0. Requires AVMInput.postalCode + comp
   *  postal. Soft kernel (no hard cutoff) so thin pockets still fall back to community. */
  geoFull: number;
  geoBlock: number;
  geoFsa: number;
}

/**
 * The pre-2026-06 behaviour: confidence-interval predSD (collapses to ~4% → bands
 * cover ~18%), ±0.4 clamp == peer trigger, no suppression. Kept for backtest A/B and
 * to document exactly what `DEFAULT_TUNING` changed.
 */
export const LEGACY_TUNING: AvmTuning = {
  predMode: 'legacy',
  adjClamp: ADJ_CLAMP,
  peerTrigger: ADJ_CLAMP,
  bandHigh: BAND_HIGH,
  bandMed: BAND_MED,
  bandLow: BAND_LOW,
  priorSd: Math.sqrt(TAU2),
  tau2: TAU2,
  tau2Schedule: null,
  suppressFloor: false,
  suppressExotic: false,
  geoFull: 1,
  geoBlock: 1,
  geoFsa: 1,
};

/**
 * PRODUCTION tuning (shipped 2026-06). Validated out-of-time on ~10k held-out 2026
 * sales AND a disjoint [6,12)-month holdout (see scripts/admin/avm-experiment.ts):
 *   median |%err| 11.5%→10.7%, mean 18.0%→15.6%, ±10% 45%→47%, BAND COVERAGE 18%→61%,
 *   2M+ bias −36%→−26%, and confidence labels made HONEST & MONOTONE (HIGH ≈ 8% err).
 * Changes vs LEGACY:
 *   • predMode 'predictive' — predSD = √(estimationVar + comp-dispersion²): a true
 *     prediction interval for THIS home; fixes the catastrophic overconfidence and the
 *     INVERTED confidence labels (HIGH was the most overconfident). Auto-widens for
 *     dispersed/atypical/expensive cohorts. Leakage-safe (as-of comp residuals only).
 *   • band thresholds recalibrated to the predictive SD scale; bandLow raised to 0.45
 *     so honest-but-wide cohorts still publish.
 *   • priorSd 0.22 — no-local-comp homes are genuinely uncertain.
 *   • adjClamp 0.9 + peerTrigger 0.25 (decoupled) — let premium homes escape the
 *     neighbourhood ceiling and route more of them to the well-calibrated peer grid,
 *     cutting the expensive-home under-valuation.
 *   • suppressFloor + suppressExotic — never publish the known-catastrophic 'floor'
 *     basis (−42…−77% bias) or unpriceable types (Vacant Land/Farm/…, 40–67% error).
 */
export const DEFAULT_TUNING: AvmTuning = {
  predMode: 'predictive',
  adjClamp: 0.9,
  peerTrigger: 0.25,
  bandHigh: 0.12,
  bandMed: 0.2,
  bandLow: 0.45,
  priorSd: 0.22,
  tau2: TAU2,
  tau2Schedule: null,
  suppressFloor: true,
  suppressExotic: true,
  // Hierarchical geographic comp weighting (validated 2026-06-17). Same building/block
  // (full 6-char postal) ×6, block cluster (FSA+LDU1) ×2.5, FSA ×1.4. Measured gain
  // (full postal): overall ±10% +1.0pp, band coverage +1.4pp, condo band +3.7pp, no
  // regressions. Pre-backfill the comp column is FSA-truncated so only the ×1.4 FSA leg
  // fires (measured ≈ neutral-positive, safe); the full gain activates once postal_code
  // is backfilled from raw_payload->>PostalCode (scripts/admin/backfill-postal.ts).
  // Subject postal comes from mapListingToAVMInput (live) / payload (backtest).
  geoFull: 6,
  geoBlock: 2.5,
  geoFsa: 1.4,
};

/** Resolve the effective prior variance for a given effective sample size. */
export function resolveTau2(tuning: AvmTuning, nEff: number): number {
  const s = tuning.tau2Schedule;
  if (!s) return tuning.tau2;
  // Linear ramp in nEff from (ltN→lt) up to (geN→ge), clamped at the ends.
  if (nEff <= s.ltN) return s.lt;
  if (nEff >= s.geN) return s.ge;
  const t = (nEff - s.ltN) / (s.geN - s.ltN);
  return s.lt + t * (s.ge - s.lt);
}
