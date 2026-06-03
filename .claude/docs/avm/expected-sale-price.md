# Expected Sale Price — the second number (spec + backtest)

**Status:** spec + offline backtest complete (`scripts/admin/expected-sale-backtest.ts`). Not yet wired into the request path.
**Companion to:** the list-blind AVM (`src/lib/avm/`, backtest `scripts/admin/avm-backtest.ts`).
**Compliance:** 100% deterministic, no LLM (CLAUDE.md §4). `list_price` is public / IDX-displayable, so using it is legal; `raw_vow_sold` stays read-only (§12). VOW-derived, so the output stays auth-gated exactly like the AVM.

---

## 1. Why two numbers

The platform's AVM is deliberately **list-blind** — it estimates value from comparable *sold* prices and structural features, never from the home's own asking price. That independence is the product (it's what lets us flag an over/under-priced listing). But it caps accuracy at **~11% median |%err|**, because the deciding ~15% of any home's price — condition, finish quality, renovations, micro-location, view — lives in the listing agent's private knowledge, which TRREB's structured fields don't carry and §4 forbids us from extracting from remarks/photos with an LLM. We have exhausted the list-blind levers (calibration, GLA, age, remarks all measured as ~0pp on median; see the `avm-*` memories).

There is exactly one **public** field that already embeds that private knowledge: the **list price**. The listing agent saw the home, priced it, and the market reacted. So we add a second, *list-aware* number that answers a different question:

| Number | Question it answers | Uses list price? | Accuracy |
| :-- | :-- | :-- | :-- |
| **AVM** (existing) | "What should a *similar* home go for in this area?" | **No** (intrinsic) | ~11% median |
| **Expected Sale Price** (this spec) | "What will *this* listing actually close at?" | **Yes** | see §5 |

They are not redundant — they answer different questions, and the relationship between them is itself information (see §6 on the arbitrage framing, including its measured limits).

---

## 2. The model

Deterministic, list-aware, leakage-safe:

```
ExpectedSale = list_price × R(cohort, market-temperature, as-of listing date)
```

`R` is a robust estimate of the **close/list ratio** — how the market has recently been paying relative to ask, for comparable homes. It is computed *only* from homes that had already **closed before the subject was listed** (no look-ahead). Homes in the GTA have been transacting at a median `close/list ≈ 0.97` (≈3% below last ask) in a softening market; in a hot market the ratio exceeds 1 (bidding wars). `R` tracks this and localizes it.

### R estimator — four escalating forms (all backtested)

| Model | `R` definition | Captures |
| :-- | :-- | :-- |
| **M0** | `R ≡ 1` → ExpectedSale = raw last list | the floor / sanity baseline |
| **M1** | median(close/list) over the **sub-type**, trailing `GLOBAL_MO` | market temperature + sub-type level |
| **M2** | **cohort** (city_region × sub-type) close/list, trailing `RATIO_WINDOW_MO`, **hierarchically shrunk** cohort → city → sub-type | + neighborhood localization |
| **M3** | M2's cohort ladder over a short `RECENT_MO` window, shrunk toward M2 | + recency (adapts to a *turning* market) |

**Shrinkage (partial pooling), in log-ratio space** — the same discipline the AVM uses for sparse cohorts:

```
lnB_shrunk = (nB·median_lnr_city  + K·lnA) / (nB + K)      # city ← sub-type prior
lnC_shrunk = (nC·median_lnr_cohort + K·lnB_shrunk) / (nC + K)  # cohort ← city prior
R = exp(lnC_shrunk)
```

so a thin cohort borrows strength from its city, and a thin city from its sub-type, instead of trusting a 3-comp ratio. Defaults: `K=12`, `RATIO_WINDOW_MO=12`, `RECENT_MO=4`, `GLOBAL_MO=6` (all CLI-tunable; see §5 for which form actually earns its keep).

### Leakage discipline (identical to the AVM backtest)

- Reference date = `purchase_contract_date` (deal signing), never `close_date`.
- `R` is built only from comps whose **deal month is strictly before the subject's deal month** and within the window — so every contributing `close/list` was a closed, known fact before the subject listed.
- The subject is never in its own comp set.
- The harness reproduces the live `cityRegionLookupCandidates` + `rawVariantsOf` cohort matching (so the ~24% prefixed-`city_region` cohorts and the `"Semi-Detached "` trailing-space spellings don't silently miss).

---

## 3. The honest caveat (must be surfaced to users)

The backtest fits `R` on, and predicts, the **last list of *sold* homes**. A sold home's last list has already absorbed any price reductions, so last-list is *very* close to the eventual close. A **fresh active listing** still showing its **original** (possibly inflated) ask has not yet corrected — its Expected Sale Price will be **modestly less accurate than the backtest number**, and the live figure is best read as a *range*, not a point.

`raw_vow_sold` carries `list_price` (100% filled) but **no `original_list_price` scalar**, so original→close is not measurable here without a targeted `full_payload` JSONB pull (`OriginalListPrice` exists in the VOW payload). That measurement — which would quantify how much the price-drop effect inflates the backtest vs. a fresh listing — is the **#1 follow-on** before shipping a headline accuracy claim.

---

## 4. How it surfaces (product)

On the individual listing page (the 70/30 view), two clearly-distinct numbers:

- **"Comparable value" (AVM)** — *"Similar homes in {community} go for ~$X"* — intrinsic, list-blind, shown as a **range** (honest ±18–20% band).
- **"Expected sale price"** — *"Based on how this market is paying vs. ask, this is likely to close around $Y"* — list-aware, tighter band.

The framing for the gap (per the product owner): *"This is what a similar home should go for; the expected sale price may differ — and that difference is the arbitrage deal-hunters look for."* **However, the backtest constrains how this gap may honestly be sold — see §6.**

---

## 5. Measured results

> Backtest: `npx tsx --env-file=.env scripts/admin/expected-sale-backtest.ts --eval-months 6`
> Held-out window: last 6 months of `raw_vow_sold` deals; leakage-safe; lease floor $50k.

**Full-window run, 2026-06-02** — last 6 months, **41,310 held-out sales**, lease floor $50k, leakage-safe.

**Headline (all sales):**

| Model | median \|%err\| | MAPE | bias (mean ln) | hit ±5/±10/±20% |
| :-- | --: | --: | --: | --: |
| M0 raw last list | 3.56% | 4.84% | +0.0270 | 65.5 / 89.7 / 98.3% |
| **M1 sub-type market ratio** | **2.19%** | 3.67% | −0.0034 | 79.0 / 92.0 / 98.5% |
| **M2 localized (shrunk)** | **2.14%** | 3.61% | **+0.0001** | 78.8 / 92.4 / 98.6% |
| M3 localized + recency | 2.13% | 3.59% | −0.0024 | 79.3 / 92.3 / 98.6% |

**Apples-to-apples** on the 40,015 homes in *both* backtests (this exactly reproduces the AVM's 10.90% baseline — confirms the join is sound):

| Number | median \|%err\| | MAPE | bias | hit ±5/±10/±20% |
| :-- | --: | --: | --: | --: |
| List-blind AVM ("similar home should go for") | 10.90% | 17.18% | +0.0171 | 26.0 / 46.8 / 72.3% |
| **Expected Sale (M2)** ("this listing will close at") | **2.10%** | 3.50% | **−0.0004** | 79.6 / 92.8 / 98.8% |

**What earns its keep:**
- The whole gain is **M1 — the market-temperature ratio** (raw list 3.56% → 2.19%, and it *zeroes the +2.7% over-prediction bias* of raw list). This single deterministic factor is ~96% of the achievable improvement.
- **M2 localization adds ~0.05pp** overall — marginal but free on the dominant cohorts (helps 2M+ 3.78→3.50, condos slightly); it slightly *hurts* thin/atypical sub-types where even shrunk cohort ratios are noisy (Semi-Detached 2.12→2.43, Link, Multiplex). Recommendation: ship **M1 as the base** and apply M2 localization only where the cohort sample is healthy (else fall back to M1).
- **M3 recency adds nothing** in this stable/softening window (2.14→2.13) — keep it as cheap insurance for a *turning* market, not a current lever.
- Best by sub-type (M1→M2): Townhouse 1.65%, Condo 2.00%, Detached 2.20%, Semi 2.12%; weakest are Vacant Land 5.3% and Farm 4.7% (thin, idiosyncratic — list still beats the AVM there). Best by tier: 500k–1M ~1.8–1.9%; worst 2M+ 3.5%.

---

## 6. The arbitrage framing — what the data actually supports

The intuitive thesis is: *AVM ≫ list ⇒ under-priced ⇒ a deal*. We tested it directly — bin the held-out homes by the signal `(AVM − list)/list` and look at the realized `close/list`. **If the gap were tradable, homes the AVM flags as under-priced (vs. ask) would close nearer or above ask.**

**Full-window result (40,015 shared homes), binned by signal `(AVM − list)/list`:**

| Signal bin | n | median **close/list** | median **close/AVM** |
| :-- | --: | --: | --: |
| AVM ≪ ask  (< −15%) | 7,306 | 0.965 | 1.277 |
| AVM < ask  (−15..−5%) | 7,765 | 0.971 | 1.068 |
| AVM ≈ ask  (−5..+5%) | 10,189 | 0.974 | 0.975 |
| AVM > ask  (+5..+15%) | 6,705 | 0.977 | 0.894 |
| AVM ≫ ask  (> +15%) | 8,050 | 0.976 | 0.771 |

**The verdict is mostly negative for the naive thesis.** `close/list` is nearly **flat** across the entire AVM-signal range — it rises only from 0.965 to 0.976, a **~1.1pp** spread, while homes close ~2.5–3.5% below final list *regardless* of what the AVM says. Meanwhile `close/AVM` swings massively and monotonically (1.277 → 0.771): when the AVM is far from list, the close follows the **list**, and the AVM was simply that-far wrong. In other words, the variance in (AVM − list) is **dominated by AVM's ±11% per-home noise, not by tradable mispricing** — "the AVM thinks it's worth 20% more than ask" is, more often than not, the AVM being 20% high, not a deal.

There *is* a faint, directionally-correct tilt (homes the AVM rates above ask close ~1.1pp nearer ask), consistent with the thesis — but it is far too small, and too confounded by the fact that we only see the *final* (already-corrected) list, to sell as "the arbitrage." The honest, defensible deal signals are therefore:

1. **Original-list vs. comparable value** (catches homes that are *still* over-asking and haven't corrected) — needs `OriginalListPrice` (§3 follow-on).
2. **Price-cut / stale-listing dynamics** — the platform's existing True-DOM / price-compression engine, which reads list-price *movement*, not a static gap.

The Expected Sale Price's real, shippable value is **its own accuracy** ("what will it close at?"), not as a denominator for a naive AVM-gap arbitrage claim.

---

## 7. Follow-ons

1. **Original-list measurement** (§3) — targeted `full_payload->>'OriginalListPrice'` pull on the eval set (PK `.in()`, chunked) to quantify the fresh-listing penalty and an original-list deal signal.
2. **Wire into the request path** — a `refresh-expected-sale.ts` precompute (or live point-lookup of a small `avm_close_list_ratio` table keyed by cohort × period) + a listing-page surface, gated like the AVM. Apply the *identical* ratio in Compare and the detail page so they can't diverge.
3. **Band** — publish a calibrated interval, not a point, with the §3 fresh-listing inflation folded in.
