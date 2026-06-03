# Force-Appreciation Card — Copy & Insight Redesign — Design Spec

**Date:** 2026-06-03
**Phase:** Value-Add Engine, Phase 2a follow-up (presentation only)
**Depends on:** Phase 2a on-listing card, shipped 2026-05-30 (`src/components/Property/ForceAppreciationCard.tsx`, `forceAppreciationView.ts`, `src/lib/avm/valueAdd/`).

---

## 1. Objective

The on-listing Force-Appreciation card prices renovation moves correctly, but its **presentation** undermines it for the analytical investor it targets. Three concrete defects, all visible on listing **W13208328** (Lisgar Detached):

1. **The headline insight contradicts the ledger.** The card says *"the market pays most for: build an addition (~400 sq ft)"* while "build an addition" sits at the bottom of "Why not the others?" at **0.5×** (net −$72k). `neighbourhoodInsight()` selects the highest **gross** move; the rest of the card ranks by **ROI / net**. The bold line recommends the one thing the ledger says to avoid.
2. **The headline doesn't reconcile with the rows.** "up to **$159,030** unlockable" but the three recommended rows sum to **$121,955**. The headline is the *uncapped multiplicative joint* (with exp-model synergy) while the rows are individually capped — a ~$37k gap the user can't reconcile.
3. **The rows are unlabelled and the multiplier misleads.** A row reads `+$60,000 −$20,000 3.0×` with no column labels; "3.0×" is gross value-to-cost, but reads as "tripled my money" (the true net profit is +$40,000, a 2.0× net).

This redesign fixes all three at the **presentation/insight seam** — copy, the insight sentence, the score legend, the row layout, and the two engine values that feed the headline — **without touching any AVM math** (coefficients, the move catalog, per-move calibration caps, or the multiplicative value model).

## 2. Why this is worth shipping (CLAUDE.md §10)

The card already exposes ROI math HouseSigma/Realtor.ca hide. But a headline that recommends a move the body rejects, and a total a user can't add up, *destroys* the trust the feature is supposed to build with a numerate audience. After this change the card reads top-to-bottom with no contradictions and a total that visibly sums — strictly cleaner and more honest than the competition, which is the bar.

## 3. Scope & decisions (locked with the user)

- **Boundary (B):** presentation + the insight/headline seam. No change to coefficient/value math, the move catalog, calibration caps, or the multiplicative model.
- **Headline (H1):** the "unlockable" figure equals the **sum of the recommended rows' Adds column**; net subtracts their Costs column. Drops the synergy joint from the headline (synergy ran backwards from reality anyway — real renovations have diminishing, not compounding, returns).
- **Rows (R2):** labelled columns `Adds · Costs · Return`, plus a `Total` row that ties to the headline. The green payback bar is dropped (the Return column makes it redundant).
- **Insight (C1):** lead with the **best net-dollar** recommended move, citing its return. No more gross-keyed selection; no asserting negative tail.
- **Score (D1):** keep the 0–100 number, **label it "Upside"** with a one-line legend, and **recompute it from the same summed gross** so it shares a basis with the headline.
- **Suppressed copy (E):** a negative coefficient is reported as *uncertainty*, not a market fact.

## 4. The card, before → after (W13208328, this exact listing)

**Before:**
```
Force-Appreciation                                           52/100
up to $159,030 unlockable · best net $115,030
In Lisgar, the market pays most for: build an addition (~400 sq ft).
finish the basement adds little here.
Add a full bathroom    +$60,000  −$20,000  ▓▓▓  3.0×
Add a bedroom          +$39,070  −$18,000  ▓▓   2.2×
Add a parking space    +$22,885  −$6,000   ▓▓▓  3.8×
▸ Why not the others?
Based on 202 Lisgar Detached sales · modeled, not appraised
```

**After:**
```
Force-Appreciation                                  Upside 40/100 ⓘ
up to $121,955 unlockable · ~$77,955 net after cost

Best payback in Lisgar: Add a full bathroom — +$40,000 after cost (3.0×).

                        Adds        Costs      Return
Add a full bathroom    +$60,000    −$20,000     3.0×
Add a bedroom          +$39,070    −$18,000     2.2×
Add a parking space    +$22,885    −$6,000      3.8×
──────────────────────────────────────────────────────
Total                  +$121,955   −$44,000   = $77,955 net

▾ Why not the others?
   Build an addition (~400 sq ft)  +$67,561  −$140,000   0.5×
   Build a detached garage         +$46,262  −$70,000    0.7×
   Renovate interior to excellent  +$20,368  −$90,000    0.2×
   Curb-appeal / exterior upgrade  +$18,074  −$20,000    0.9×
   Finish the basement          local sales don't show a reliable premium
   Add a legal basement suite   local sales don't show a reliable premium

Based on 202 Lisgar Detached sales · modeled, not appraised
```

`ⓘ` = a native `title` tooltip (no JS): *"Upside = the share of this home's value you could add by renovating, before cost (0–100)."*

## 5. Detailed design

### 5.1 Engine — `src/lib/avm/valueAdd/engine.ts`

**(a) Surface the recommended set.** The greedy non-overlapping positive-payback selection already exists but is computed for the headline and thrown away. Instead, flag it onto the moves so the card renders exactly that set:

```ts
const evaluated = MOVE_CATALOG.map((m) => evaluateMove(input, m, market, P0))
  .sort((a, b) => b.netGainTyp - a.netGainTyp);

const claimed = new Set<string>();
const recommendedKeys = new Set<MoveKey>();
for (const mv of evaluated) {
  if (mv.status !== 'priced' || mv.paybackRatio <= 1) continue;
  const fields = byKey.get(mv.key)!.deltas.map((d) => d.field);
  if (fields.some((f) => claimed.has(f))) continue;     // non-overlapping
  fields.forEach((f) => claimed.add(f));
  recommendedKeys.add(mv.key);
}
const moves = evaluated.map((m) => ({ ...m, recommended: recommendedKeys.has(m.key) }));
```

**(b) Headline = additive sum of the recommended rows** (replaces the joint `rawStackValue` re-eval). This is the change that makes the column tie out:

```ts
const recommended = moves.filter((m) => m.recommended);
const grossSum = recommended.reduce((a, m) => a + m.valueAddTyp, 0);   // already per-move capped
const costSum  = recommended.reduce((a, m) => a + m.costTyp, 0);
const headlineUpsideGross = Math.max(0, Math.round(grossSum));
const headlineUpside      = Math.max(0, Math.round(grossSum - costSum));
const valueAddScore       = Math.min(100, Math.round((grossSum / P0) * SCORE_K));
```

- Removes the `applyMove(selectedDeltas)` + joint `rawStackValue` + `PCT_CAP_STACK` clamp from the headline path. **`rawStackValue` stays** — `evaluateMove` still uses it per-move. The headline dollar figure is intentionally bounded only by the **per-move caps** (each row ≤ its `capHigh` and ≤ 12% of home value via `capValueAdd`), not by a stack cap — re-clamping the sum would reintroduce the very mismatch we are removing. The score remains capped at 100.
- `SCORE_K` stays **350**. Scores shift down across all listings (W13208328: 52 → 40) because the basis is now the honest sum, not the synergy joint. Intended.

**(c) Re-key the insight (C1).** `neighbourhoodInsight()` selects the **best net-dollar recommended** move and drops the asserting negative tail:

```ts
function neighbourhoodInsight(input, _market, moves): string {
  const rec = moves.filter((m) => m.status === 'priced' && m.recommended);
  if (rec.length === 0) {
    const anyPriced = moves.some((m) => m.status === 'priced');
    return anyPriced
      ? `No renovation in ${input.cityRegion} is projected to pay for itself right now.`
      : `Renovation premiums in ${input.cityRegion} are hard to model from current sales.`;
  }
  const best = rec.reduce((a, b) => (b.netGainTyp > a.netGainTyp ? b : a));
  return `Best payback in ${input.cityRegion}: ${best.label} — +${formatPrice(best.netGainTyp)} after cost (${best.paybackRatio.toFixed(1)}×).`;
}
```

- Uses `formatPrice` from `@/lib/utils` (lib→lib import; deterministic template, no LLM — CLAUDE.md §4 preserved).
- The named move is always one of the rows the user sees — the contradiction is structurally impossible now.

**(d)** `suppressed()` and `evaluateMove()` set `recommended: false` on the base object (overwritten by the map in (a)) to satisfy the type.

### 5.2 Calibration — `src/lib/avm/valueAdd/calibration.ts`
Remove the now-unused `export const PCT_CAP_STACK`. (Grep-confirmed: referenced only by `engine.ts` and `engine.report.test.ts`.)

### 5.3 Types — `src/lib/avm/valueAdd/types.ts`
Add `recommended: boolean` to `ValueAddMove`.

### 5.4 View-model — `src/components/Property/forceAppreciationView.ts`
- Partition by the **flag**, not a slice: `recommendedRows = priced && recommended`; `moreRows = priced && !recommended`; `suppressed` unchanged. (Replaces the `topRows = priced.slice(0,3)` heuristic, which could show a non-recommended row or hide a recommended one.)
- Rename `topRows → recommendedRows` in `ForceAppreciationView`; add `totalCosts: number` (= Σ recommended `costTyp`) for the Total row. `headlineGross`/`headlineNet`/`score`/`insight`/`basis` wiring unchanged.
- **`REASON_COPY.negative_beta`** (E): `"the local market doesn't pay extra for this"` → **`"local sales don't show a reliable premium"`**. Other reasons unchanged.

### 5.5 Component — `src/components/Property/ForceAppreciationCard.tsx`
- **Score chip:** `Upside {v.score}/100` with a `title` legend tooltip (server-rendered, no JS).
- **Headline:** `up to {formatPrice(v.headlineGross)} unlockable · ~{formatPrice(v.headlineNet)} net after cost`.
- **Ledger:** a 4-column grid — label · Adds · Costs · Return — with a header row and a `Total` row (`+{headlineGross} −{totalCosts} = {headlineNet} net`). Remove the `PaybackBar` component.
- **Disclosure** (`<details>` "Why not the others?"): `moreRows` rendered with the same columns; `suppressed` as label + reason copy.
- **Empty recommended set:** when `recommendedRows` is empty (no move pays back), omit the "`up to … unlockable`" headline line (the §5.1c insight sentence carries the message, so there is no duplicate), omit the Total row, and render the priced `moreRows` **expanded** (not collapsed) so the card isn't empty. `shouldRender` is unchanged (still requires ≥1 priced move).
- **Locked teaser:** update the blurred placeholder text to match the new headline phrasing (cosmetic).

## 6. Edge cases
- **No positive-payback moves (all renos lose money here):** §5.5 empty state; `headlineNet`/`score` = 0, ledger still honest.
- **>3 recommended moves:** all render (non-overlapping fields across 9 catalog moves bound this to a handful); the Total still sums exactly what's shown — no arbitrary "top 3" cut.
- **Condo / lease / thin cohort:** most/all moves suppress → `shouldRender` false → no card (unchanged).
- **Estimate unavailable / engine throws:** `valueAdd` null → no card (unchanged; best-effort try/catch in `getListingDetail`).

## 7. Explicitly NOT changing
Coefficients, the move catalog, per-move caps and the rest of the calibration trust layer, the multiplicative `rawStackValue` value math, cost benchmarks, the AVM, the VOW/IDX data paths, compliance posture (IDX-derived, anonymous-visible, brokerage display untouched, single-listing ≤100 rule N/A), and the zero-client-JS server-component + native `<details>` architecture.

## 8. Testing (vitest, node-env — pure logic; UI via typecheck + lint + build + manual)
- **Engine** (`engine.report.test.ts`): `headlineUpsideGross === Σ recommended valueAddTyp` and `headlineUpside === gross − Σ recommended costTyp` (the tie-out); `recommended` flag set only on the greedy non-overlapping positive-payback set; `valueAddScore` derived from the sum and ∈ [0,100]; `neighbourhoodInsight` names the best-net recommended move and contains no "pays most for"; empty-recommended → empty-state sentence. Remove the `PCT_CAP_STACK` import and its `≤ stack-cap` assertion (lines 6, 61); keep `gross ≥ net` and the linear-P0-scaling tests.
- **View-model** (`forceAppreciationView.test.ts`): `recommendedRows`/`moreRows`/`suppressed` partition by flag; `totalCosts` tie-out; `suppressReasonCopy` covers every `SuppressReason` with the new `negative_beta` string.
- **Regression:** confirm `engine.math.test.ts` (tests `rawStackValue` directly — unchanged) and `engine.fetch.test.ts` stay green.

## 9. Files
| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/lib/avm/valueAdd/types.ts` | add `recommended: boolean` to `ValueAddMove` |
| Modify | `src/lib/avm/valueAdd/engine.ts` | flag recommended set; headline = Σ recommended; score from sum; re-key insight (C1); drop joint/`PCT_CAP_STACK` from headline |
| Modify | `src/lib/avm/valueAdd/calibration.ts` | remove unused `PCT_CAP_STACK` |
| Modify | `src/components/Property/forceAppreciationView.ts` | partition by flag; add `totalCosts`; rename `topRows→recommendedRows`; reword `negative_beta` copy |
| Modify | `src/components/Property/ForceAppreciationCard.tsx` | labelled columns + Total row; `Upside n/100` + legend; headline copy; drop bar; empty state; locked-teaser copy |
| Modify | `src/lib/avm/valueAdd/engine.report.test.ts` | sum tie-out + recommended-flag + C1 insight asserts; drop `PCT_CAP_STACK` |
| Modify | `src/components/Property/forceAppreciationView.test.ts` | flag partition + totals + new `negative_beta` copy |

## 10. Rollout
Single branch off `main`. No flag (server-rendered; degrades to nothing). Verified by the test suite + `tsc` + `lint` + `build`, then a manual spot-check on a Lisgar/Brampton detached listing (rich cohort, recommended rows present) and a condo (expect no card).
