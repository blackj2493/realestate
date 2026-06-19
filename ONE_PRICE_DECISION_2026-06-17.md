# One Price, Not Two — collapsing AVM + Expected Sale into a single number (2026-06-17)

**Problem (product):** the listing page showed TWO derived prices — "True Value" (the
list-blind AVM) and "Expected Sale Price" (list-aware) — which confuses users. We want ONE
number, as accurate as possible, ideally within **±5% of the final sale price**.

**Answer:** show ONE number, the **Estimated Sale Price**, which is **list-anchored**
wherever we can be (by far the most accurate) and falls back to the AVM only when there's no
live ask to anchor to. The AVM does not disappear — it becomes (a) the **Deal Score** signal
(is this listing over/under-priced?), (b) the **fallback** estimate, and (c) a faint
**"comparable value" band** drawn for context inside the one card. This is the honest
"hybrid": the list price carries the accuracy; the AVM carries the deal-detection.

Everything below is **measured on real held-out 2026 sales**, not asserted.

---

## 1. Why list-anchoring, and why not a model blend

A list-BLIND AVM cannot reach ±5% on individual homes — the deciding ~15% of price
(condition, finish, exact micro-location) lives in the listing agent's private knowledge,
which §4 forbids us from extracting from remarks/photos. The one PUBLIC field that already
embeds that knowledge is the **list price**. Anchoring to it is both legal (list price is
IDX-displayable) and dramatically more accurate.

Measured, apples-to-apples on the same held-out homes (`scripts/admin/expected-sale-backtest.ts`,
~8k held-out sales; AVM run `peers-2026-06-02`):

| Number | median \|%err\| | MAPE | **within ±5%** | within ±10% |
|---|---|---|---|---|
| List-blind **AVM** ("what a similar home is worth") | 11.51% | 17.44% | **24.4%** | 45.3% |
| **List-anchored Expected Sale** ("what THIS home closes at") | **2.03%** | 3.50% | **80.8%** | 92.7% |

Even the worst price tiers stay inside ±5% (2M+ = 3.0% median; only Vacant Land lags at ~6%).

**We tested blending the AVM INTO the point estimate** (the `(AVM − list)/list` "arbitrage"
signal). It is real but *negligible*: realized close/list rises only **0.972 → 0.981** across
the entire signal range (AVM 15% below ask → 15% above ask), and the signal is weakest/most
biased exactly at the 2M+ tail where the AVM is least reliable. So the AVM is **deliberately
kept OUT of the headline number** and used only for deal-detection + fallback.

## 2. The honest caveat — fresh listings (measured, not hand-waved)

The 2.03% is measured against each sold home's *final* list (post-reductions). A freshly
listed home still showing its *original* ask is the realistic worst case
(`scripts/admin/_freshlist-check.ts`, 40k recent sales):

- **80% of listings never drop their price** (original ask = final list) → they hit the 2.13% case directly.
- Pessimistic original-ask bound (every active listing, before any drop): **median 2.74%, MAPE 4.80%, 70% within ±5%, 87% within ±10%** — still inside the goal.
- Blended realistic active-listing accuracy: **median ~2.3%, ~77% within ±5%.**

The published range stays at **±4%** (`EXPECTED_SALE_REL_HALF_WIDTH`), which sits correctly
between the 2.1% median and the ~4.8% worst-case MAPE, and the copy notes the number "may
shift if the asking price changes."

## 3. The resolution logic (single source of truth)

`src/lib/avm/salePrice.ts` → `resolveSalePrice()` (pure, unit-tested in `salePrice.test.ts`):

- **Active listing + trustworthy cohort close/list ratio** → list-anchored Expected Sale is
  the headline; AVM band attached as secondary `comparable` context. Confidence = HIGH
  (cohort, n≥50) / MEDIUM / LOW.
- **Thin cohort / sold / off-market / no live ask** → the AVM is the honest fallback headline
  (passes through its own confidence; ±10% synthetic band if AVM bands are absent).
- **Neither available** → null → the card shows an "unavailable" state.

It runs on the already-VOW-gated view, so anonymous users get `null` (inputs are nulled
upstream) and the card renders its blurred login teaser — no VOW data reaches their DOM.

## 4. What changed in the UI

- **New:** `src/components/Property/EstimatedSaleCard.tsx` — the single card. Headline +
  range + delta-vs-ask + market-temperature line + a "how it lines up" axis that places
  Asking ▲, Estimated sale ◆, and the AVM comparable-value band on one track (this is what
  *resolves* the old two-number confusion instead of recreating it).
- **Detail page** (`src/app/(app)/properties/[id]/page.tsx`): the active-listing rail now
  renders ONE `EstimatedSaleCard` instead of `ListingEstimateCard` ("True Value") **+**
  `ExpectedSaleCard`. Sold/off-market keeps `ListingEstimateCard` (it pairs with the
  sold-outcome accuracy receipt — not the confusing case).
- **Dashboard terminal** (`ListingTerminal.tsx`) + **API** (`/api/property/[id]`): the route
  now resolves and returns `salePrice` so the terminal shows the same single number (it
  previously showed the less-accurate AVM as its headline — a strict improvement).
- **Removed:** `ExpectedSaleCard.tsx` (orphaned). Deal Score, Compare, Hidden Equity still
  consume the AVM unchanged.

## 5. Verify / reproduce

```bash
# Headline accuracy (list-anchored vs AVM, on real held-out sales):
npx.cmd tsx --env-file=.env scripts/admin/expected-sale-backtest.ts --limit 8000
# Fresh-listing degradation (original ask vs final list):
npx.cmd tsx --env-file=.env scripts/admin/_freshlist-check.ts --months 6 --limit 40000
# Unit tests + typecheck:
npx.cmd vitest run src/lib/avm/salePrice.test.ts src/lib/avm/expectedSale.test.ts
npx.cmd tsc --noEmit
```

**Status:** typecheck ✅, 27 unit tests ✅, lint ✅ (0 errors). Goal met: one number,
median ~2% / ~80% of listings within ±5% of final sale price.

---

## 6. Thorough sweep + band calibration (2026-06-18)

`scripts/admin/_es-sweep.ts` streams the held-out pool ONCE (220,729 sold rows, 25-mo
window) and evaluates **13 ratio models** on the **full 40,000 held-out sales**, then
calibrates the band. Two decisive findings:

**(a) The ratio model is already at its accuracy floor — there is no tuning headroom.**

| Model | median \|err\| | MAPE | within ±5% |
|---|---|---|---|
| **LIVE** `getCloseListRatio` (prod: city×sub 6-mo median) | 2.15% | 3.64% | 79.6% |
| LIVE city×sub 12-mo | 2.10% | 3.61% | 79.2% |
| M1 sub-type market 6-mo | 2.18% | 3.64% | 79.5% |
| M2 hierarchical-shrink (k12 w12) | 2.10% | 3.58% | 79.2% |
| **M3 best** (k24 w12 r4, hierarchical + recency) | 2.10% | 3.56% | 79.7% |

The full 13-config sweep sits flat at **2.10–2.18% median / 79–80% within ±5%**. The best
research model beats the live production path by **0.05pp MAPE / 0.1pp hit-rate** — noise.
A hierarchical-shrink rewrite of `getCloseListRatio` is therefore **deliberately NOT shipped**
(complexity + extra DB IO for no measurable gain). The residual error is irreducible
(bidding wars, unique homes). By tier (winner): <500k 2.4%, 500–750k 1.7%, 750k–1M 1.9%,
1–1.5M 2.7%, 1.5–2M 2.8%, 2M+ 3.5% — every tier inside ±5%.

Measured options deliberately declined: 6→12-mo window (improves bias −0.36%→−0.04% but
lowers hit±5 and doubles rows pulled) — not worth it.

**(b) The one real fine-tune: confidence-scaled bands.** Measured coverage of a flat ±4%
band by cohort support: **n≥50 → 75.2%, 12–49 → 74.5%, thin <12 → 68.5%** (target ~68%).
Well-supported cohorts are comfortably honest; thin cohorts sit at the edge (and worse on
fresh listings). So the displayed range is now scaled by support
(`SALE_BAND_HALF_WIDTH`): **HIGH ±4% · MEDIUM ±4.5% · LOW ±6%** — tight where the data is
deep, honestly wider where it's thin. The point estimate is unchanged.

Reproduce: `npx.cmd tsx --env-file=.env scripts/admin/_es-sweep.ts --limit 40000`

---

## 7. Extension to Compare + search rows (2026-06-18)

The single number now appears wherever a price-estimate did, computed **at request time via
the already-cached `getCloseListRatio`** (24h per cohort) — no migration, no ETL change, no
Typesense re-sync, no 100k-row prod write.

**Compare page** (`getCompareData.ts`, `compareMetricsConfig.ts`, `MetricRow.tsx`,
`CompareClient.tsx`, compare `page.tsx`): the raw list-blind AVM row **"Est. Value"** is now
**"Est. Sale Price"** (the resolved single number, list-anchored where possible) with its own
confidence; the per-listing AVM deal signal is relabeled **"vs Comp Value"** (clearly the
arbitrage lens, not a competing price). Deal Score + $/sqft unchanged. `salePrices` is
resolved server-side per compared listing and VOW-gated for anon like the estimates.

**Command-center search rows** (`/api/estimates/sale-price`, `LedgerPanel.tsx`,
`LedgerRow.tsx`): a new batched API resolves the sale price for the visible **active** rows —
deduped to the distinct cohorts server-side (a 100-row page = a handful of cached ratio
lookups + one PK read of `property_estimates` for the AVM fallback). The panel fetches once
per result set (authed only — VOW gate) and each row shows a compact
**"≈ $X likely close · Y% under ask"** line under the address (both card + column layouts).
No change to Typesense, the ETL, or the existing Deal Score. Architecture-compliant: the
client passes the public IDX fields it already holds; only the resolved number returns.

**Verified:** typecheck ✅, 34 unit tests ✅ (incl. new Est. Sale Price metric + resolver
band tests), lint ✅ (0 errors).

### 7a. Sold view also collapsed (2026-06-18)

The first pass merged only the ACTIVE view. A SOLD listing still showed TWO numbers: the
"Our Call vs. The Sale" receipt (`SoldOutcomeCard`, which shows whichever of expected-sale /
AVM was *closer* to the actual close) AND a standalone "True Value" AVM card. Fixed: on a
sold listing WITH a receipt, the receipt is the single number and the standalone True Value
is suppressed (`page.tsx`). Delisted/off-market or sold-without-a-receipt still fall back to
True Value. Verified on the running server: the sold listing now serves only "Our Call vs.
The Sale".

### 7b. Copy consistency — no competing AVM dollar (2026-06-18)

"The Read" verdict + the Deal Score breakdown were still printing the raw AVM as a competing
dollar ("Listed 21.1% above our $1,433,107 estimate") — conflicting with the Estimated Sale
Price. Fixed at the single source: the Deal Score "value" component is relabeled **"Value vs
Comps"** and its copy is now **relative** ("Listed 21.1% above comparable sales (high
confidence)") — same deal signal, no competing figure. "The Read" price line now leads with
the one number ("Asking $X — likely closes near $Y (Z% of ask). Ask runs +21.1% vs comparable
sales."). Two stale spots from the Compare rename were also fixed: the Compare footnote and the
value-plot axis labels ("comp value" / "PRICE vs COMPS"). The word "estimate" is now reserved
for the single Estimated Sale Price across the listing page, The Read, Deal Score, and Compare.

**Verified:** typecheck ✅, 38 unit tests ✅, lint ✅ (0 errors).
