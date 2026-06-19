# AVM Accuracy Overhaul — 2026-06-17

The AVM is the central number driving Deal Score, Expected Sale, Hidden Equity, Compare,
and the listing estimate. This is a first-principles diagnosis of *why* it was "so low and
so off" for many homes, and a measured, validated set of fixes.

Everything here is **measured on real held-out sales**, not asserted. A fast, leakage-safe,
out-of-time backtest harness (`scripts/admin/avm-experiment.ts`) replays the exact live
model against ~10k held-out 2026 sales and was validated to reproduce the production
backtest within 0.1pp.

---

## 1. The diagnosis (what was actually wrong)

Two independent, severe failures — both directly cause "my home shows so low / I don't trust this":

### A. The confidence bands were lying — and inverted
- A "1-σ" band covered the true price only **18%** of the time (an honest 1-σ band covers ~68%). Bands were **~3.7× too narrow**.
- **The confidence labels were inverted**: "HIGH confidence" estimates had the *worst* band coverage (16%) — the model was most overconfident exactly when it claimed certainty.
- **Root cause:** `predSD` was a *confidence interval for the neighbourhood mean* (`SIGMA2/nEff`), which collapses to ~4% as comps accumulate. What a homeowner needs is a *prediction interval for their specific home*, which must include the irreducible **spread of comparable sales** (~18%). The code already computed that spread (the Huber `scale`; the peer `variance`) and then threw it away by dividing by `nEff`.

### B. Systematic bias: cheap homes over-valued, expensive homes badly under-valued
Signed bias by price tier (negative = estimate runs LOW):

| Tier | bias | median \|%err\| |
|---|---|---|
| <500k | **+14.8%** (over) | 17.5% |
| 500k–1M | −0.8% | 9.4% |
| 1M–1.5M | −9.2% | 11.4% |
| 1.5M–2M | −17.9% | 14.6% |
| 2M+ | **−35.8%** (under) | 23.5% |

Bias by *property type* was ~0 (Detached −1.5%, Condo +1.3%) — so this is **deviation-from-
cohort-median bias**, not a type problem. Mechanisms:
- **`ADJ_CLAMP = 0.4`** capped every home at +49%/−33% of its neighbourhood level. A 2M+ home in a mixed community literally could not be priced above ~1.5× the local median.
- The **peer comp-grid works** (−1.6% bias) but only caught homes whose `Σβz` saturated the clamp; feature-weak luxury homes (lot 36% null, ridge-shrunk betas, dead condition tiers) stayed on the clamped/shrunk `local` path at −32% bias.
- The **`floor` / `blend` bases were catastrophic** (−42% / −108% at 2M+) — known-bad numbers shown anyway.
- **Exotic types** (Vacant Land 41–67% error, Farm, Mobile, multiplex) were shown wildly wrong instead of suppressed (only 2% of estimates were ever withheld).

### Data facts that shaped the fixes
- `building_area_total` is **83.7% present** in sold data (not "~0%" as an old code comment claimed — that was the *active* feed). Sqft is usable.
- `lot_width`/`lot_depth` **36% null**; **condition tiers carry ~no signal** (interior is ~always "3"; tiers 4–5 are unreachable by design).
- High-value columns **present but unused**: `approximate_age`, `association_fee` (condos = 29% of market), `postal_code` (geo), `architectural_style`.
- Matrix coefficients are trained **offline** (external CSV) — but the anchor, trend, comp selection, calibration, and suppression are all in-repo and were the levers used here.

---

## 2. The fixes (shipped as `DEFAULT_TUNING` in `src/lib/avm/types.ts`)

All point-estimate math defaults are unchanged for **typical** homes; the legacy behaviour is
preserved as `LEGACY_TUNING` for regression tests and A/B.

1. **Predictive prediction-interval (`predMode: 'predictive'`)** — `predSD = √(estimationVar + compDispersion²)`. Uses the comp spread already in hand (100% as-of → leakage-safe). Fixes the overconfidence AND auto-widens bands for dispersed/atypical/expensive cohorts (the honest band is ±15% for liquid mid-market, ±40% for 2M+ — the comp dispersion produces that gradient for free). **Does not change point estimates.**
2. **Recalibrated confidence/suppression thresholds** for the new SD scale (`bandHigh 0.12`, `bandMed 0.20`, `bandLow 0.45`, `priorSd 0.22`).
3. **Decoupled `peerTrigger` (0.25) from `adjClamp` (0.9)** — route more premium homes to the well-calibrated peer grid AND let the local path escape the neighbourhood ceiling.
4. **Suppress known-catastrophic outputs** — the `floor` basis and unpriceable types (Vacant Land/Farm/Mobile/Triplex…). `Link`, `Duplex`, `Modular`, condos stay published.

---

## 3. Measured results (leakage-safe, ~10k held-out 2026 sales)

| Metric | Baseline | **Shipped** | Out-of-sample* |
|---|---|---|---|
| Median \|%err\| | 11.49% | **10.7%** | 10.2% |
| Mean \|%err\| | 17.98% | **15.6%** | 15.4% |
| ±10% / ±20% hit | 45.2 / 71.1% | **47.4 / 74.3%** | 49.2 / 76.0% |
| **Band coverage** (ideal ~68%) | **18.4%** | **~61%** | 61.8% |
| 2M+ bias | −35.8% | **−25.8%** | −17.2% |
| 2M+ median \|%err\| | 23.5% | **19.6%** | 16.9% |
| Confidence labels | **inverted** | **honest, monotone** (HIGH ≈ 8% err) | — |

\*Disjoint holdout window (months 6–12 ago) the band thresholds never saw — gains generalize, so the recalibration is **not overfit**.

**Cost:** estimates withheld ("unavailable") rose from 2.1% → **7.6%** — almost entirely unpriceable exotic types and the known-bad `floor` basis. An honest "we can't price this confidently" is the intended behaviour for those; standard dwellings publish as before.

The single biggest user-facing win: **bands went from lying (18% coverage) to honest (~61%)**, and a "HIGH confidence" label now genuinely means ~8% typical error instead of being the *most* overconfident. An expensive-home owner now sees an honest wide range + appropriate confidence instead of a confidently-wrong low number.

---

## 4. What's still hard (Phase 2)

The residual <500k over-valuation (+14%) and 2M+ under-valuation (−26%) are substantially
**irreducible with the current features** — they come from factors the model cannot see
(condition/renovation, exact micro-location, luxury finishes, lot premium) plus a statistical
binning artifact. The calibration fix means these now show **honest wide bands + LOW confidence**
rather than confident wrong points. To cut them *further* (in rough leverage order):

1. ~~**Geographic comp weighting**~~ — **BUILT & MEASURED (see §6).** Small but real, condo-concentrated; shipped (geo-on), full gain pending a postal backfill.
2. **Condition signal** — interior tiers are dead; per-room finish parsing would let the model distinguish a fixer from a renovated unit (the core <500k problem).
3. **Use `association_fee` for condos** and `approximate_age` as comp-similarity / anchor signals (no beta retraining needed).
4. **Monthly trend bucketing + interpolation** (currently half-year nearest-neighbor). Gated on a de-stale diagnostic — measure first.
5. **Fix the train/serve sqft skew** — live subjects use a ×1.5 grossed-up room-sum while comps use actual sold sqft.

---

## 5. How to reproduce / iterate

```bash
# Baseline (legacy) vs shipped production, on real held-out sales:
npx tsx --env-file=.env scripts/admin/avm-experiment.ts --limit 10000 --variant baseline --out base.json
npx tsx --env-file=.env scripts/admin/avm-experiment.ts --limit 10000 --variant prod --out prod.json
npx tsx scripts/admin/avm-bt-analyze.ts prod.json        # error decomposition + calibration
npx tsx scripts/admin/avm-calibration.ts prod.json       # band-coverage calibration
# Out-of-sample (disjoint earlier window):
npx tsx --env-file=.env scripts/admin/avm-experiment.ts --variant prod --eval-end-months-ago 6 --out oos.json
```

Tune knobs live in `AvmTuning` (`src/lib/avm/types.ts`); add a variant in `buildTuning()`
(`avm-experiment.ts`) to A/B any change against ground truth before shipping it.

---

## 6. Geographic comp weighting — built & measured (2026-06-17)

**Data correction:** the full 6-char postal IS stored — in `raw_vow_sold.raw_payload.PostalCode` for **100%** of rows. The scalar `postal_code` column is FSA-truncated (3-char) on ~97% of legacy rows (the current ingester writes the full code; only legacy backfill rows are truncated).

**Built:** `geoMatchWeight` (`anchorService.ts`) — a hierarchical multiplicative upweight of nearby comps applied in BOTH the anchor and peer comp-weighting paths: same full postal (building/block) ×`geoFull`, same FSA+LDU1 (block cluster) ×`geoBlock`, same FSA (neighbourhood) ×`geoFsa`, else ×1.0. Soft kernel (no hard cutoff → thin pockets fall back to community). Knobs in `AvmTuning`; subject postal from `mapListingToAVMInput` / payload.

**Measured** (10k held-out, same cached pool, only the weights differ; shipped = `geoFull 6 / geoBlock 2.5 / geoFsa 1.4`):

| State | overall ±10% | overall band | condo band | mean \|%err\| | suppress |
|---|---|---|---|---|---|
| geo off (prior prod) | 47.4% | 60.7% | 57.2% | 15.6% | 7.6% |
| geo on, **FSA-only** (live pre-backfill) | 47.7% | 60.8% | 58.0% | 15.5% | 7.8% |
| geo on, **full postal** (post-backfill) | **48.4%** | **62.1%** | **60.9%** | **15.2%** | 8.1% |

- **Honest verdict:** a *small but real, monotonic, no-regression* gain — concentrated in **condos** (band coverage +3.7pp, mean −0.7pp) and the <500k tier. Much smaller than the raw leave-one-out headroom (which compared against a naive community median); the AVM's existing recency+similarity weighting already captures most of the location signal indirectly. `±10%` hit (a pure point-estimate metric) rises monotonically with strength, confirming the estimates genuinely improve, not just via suppression.
- **Shipped on** (`DEFAULT_TUNING`): safe pre-backfill (FSA-only leg ≈ neutral-positive, measured). The full gain activates automatically once `postal_code` is backfilled.
- **Backfill DONE (2026-06-17):** ran `scripts/admin/backfill-postal.ts` → **216,846 rows** rewritten from `raw_payload->>PostalCode` (13 rows genuinely lack a full postal). The scalar `postal_code` column now carries the full 6-char code, so the live AVM (which reads that column for comps) operates the geo weighting at full block/building granularity. Idempotent/keyset-batched/pooler-connected — a value UPDATE, not a schema change; re-runnable. The daily ingester already writes full postals, so new rows stay consistent.

**Future geo upside:** this is FSA/postal-prefix matching. True distance kernels (postal-centroid or lat/long) would capture the finer within-postal signal — the next rung if geo proves worth deeper investment.
