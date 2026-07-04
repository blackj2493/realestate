# Persona Value-Add — First-Principles Analysis & Implementation Plan
**Date:** 2026-06-22  ·  **Status:** Analysis complete, decision-ready. No code changed.
**Method:** Two multi-agent ultra passes (44 agents, ~3.8M tokens), adversarially stress-tested. Every load-bearing claim verified in code.

---

## 0. Calibrated confidence (read this first)

| Question | Confidence | Basis |
| --- | --- | --- |
| **Diagnosis** — personas are a cosmetic preset over one inventory | **~0.95** | Verified in code (§2) |
| **Architecture direction** — one accuracy spine → four persona translators, each with its own killer number + offer band | **~0.82–0.85** | With the 4 robustness fixes (§5) applied |
| **"Best solution in the world"** assertable *by analysis* | **caps at ~0.85** | Cannot reach 0.97 without ship-and-measure |
| **Sequencing** (which persona first / which scan) | **~0.48** | Gated on unvalidated empirical bets (§8) |

Architecture-confidence climbed **0.55 → 0.72 → ~0.85-with-fixes** across two passes whose critics were forbidden from penalizing irreducible uncertainty — and it **asymptotes below 0.97**. The residual gap is empirical, not analytical: it closes only by shipping a thin instrumented slice and measuring (§8). The single binding fact: **100% of the differentiated value is VOW-gated and invisible to anonymous visitors** (`sale-price/route.ts:48`).

---

## 1. The brief

> *"Our USP is persona flexibility, but the product isn't giving the best value to each persona. Make the site famous for persona value-add."* — and the non-negotiable bar (CLAUDE.md §10): every feature must be measurably better than HouseSigma/Realtor.ca on ≥1 dimension.

---

## 2. The verified diagnosis: a persona is a *skin*, not a *product*

A `PersonaDef` (`personaConfig.ts`) is just `{filter sliders + Typesense filter_by + sortBy + columns + map color}`. Everything deeper is shared and only re-weighted:

| Finding | Proof |
| --- | --- |
| Deal Score pillars are **persona-independent**; only a 4×4 weight matrix differs | `computeDealScore.ts` |
| The **Offer Band is persona-independent** — flipper & homebuyer told to offer the same price | `computeDealScore.ts:480` (single `computeOfferBand`) |
| The **Alpha Flag is persona-independent** (one fixed priority for all) | `getAlphaFlag.ts` |
| The underwriting **sandbox is one-size-fits-all** (cashflow right *by accident*) | `computeUnderwriting.ts` |
| **Two persona states, conflicting defaults**: terminal=`flippers`, dashboard=`smart`; detail/Compare hard-default `smart` | `commandCenterStore.ts:265`, `dashboard/config.ts:22`, `fromListingDocument.ts:32` |
| Rent is **fabricated** at 0.4% of price even though the ETL already computes a real rent | `computeUnderwriting.ts:37` vs `transformer.ts:856` |
| Suite income is a **flat fabricated `$1500`** | `computeUnderwriting.ts:34,184` |
| `cap_rate_est` is **`?? 0`-coerced** (no null), so a blind cashflow sort silently mis-ranks the ~53% with no rent | `transformer.ts:1064` |
| `TaxAnnualAmount` is **`index:false`** → the `maxTaxes` filter 400s | `typesenseSchema.ts:168` |
| Builder "zoning" is **fiction**: `zoning_designation` empty, `multiplex_by_right` hardcoded false, `is_density_ready` = parking heuristic | `transformer.ts:1085`, `getAlphaFlag.ts:39` |
| **Live §10 violation**: `is_density_ready` fires an unconditional `DENSITY READY` chip to anon users; `theRead.ts:97/99` emits "density-ready zoning" copy from fiction fields | `getAlphaFlag.ts:39`, `theRead.ts:97/99` |

> A saved "Lens" snapshots `persona + filters + colorMetric` — i.e. **a Lens is functionally a user-defined persona.** That proves the point: persona ≡ preset.

---

## 3. The reframe (thesis)

> **A persona is a different *valuation model*, not a different filter.** The same listing should be re-underwritten through each persona's objective function and emit **ONE strategy-native number an operator would stake an offer on**, plus a persona-native offer band: *"the price at which this becomes a deal for you."*

---

## 4. The architecture: one spine, four translators

**SPINE (the verified accuracy moat, persona-independent).** `computeExpectedSale(listPrice, closeListRatio)` backtests at **~2.1% median |%err| on ~41k held-out sales** (`expectedSale.ts:9`, `salePrice.ts:60-65`) vs the comp AVM's ~11%. Carries `spineScope` (`cohort | city | avm-fallback`) because it returns NULL on thin (<12-sample) cohorts and silently degrades to the 11% AVM — the headline accuracy is **not universal** and the UI must show which number it is. **Hard VOW-gated** (`sale-price/route.ts:48`).

**LENS-VALUE CONTRACT** (one typed object every surface renders): `{ likelyClose, band, spineScope, killerMetric, killerMetricCoverage: measured|imputed|unavailable, imputedTerms[], offerBand, bandProvenance, alpha, state: ready|partial|degraded|stale|unavailable }` + a **coverage-floor rule**: below a defined populated-sub-term fraction the lens renders `degraded` (metric hidden + caveat), never `partial`, so a fabricated number never sits next to a precision claim.

**ONE RESOLVER** `resolvePersona(scope, sources)` — identical precedence chain (`profileObjective → surface-persisted → urlParam → default`); only the default terminus differs (terminal may default to a transient analysis persona; durable surfaces default through profile then `smart`). Removes the three conflicting defaults without flattening the documented terminal/dashboard independence. `personaFromProfile` made total (explicit `smart` branch).

**FOUR TRANSLATORS** via a shared pure module `src/lib/persona/killerMetrics.ts`, imported by both the live detail path and the (later) nightly precompute, so Tier-A/Tier-B reconciliation is structural, not disciplinary (mirrors `refresh-property-estimates.ts` importing `calculator.ts`).

---

## 5. Per-persona blueprint (robustness fixes applied)

| Persona | Killer number | Offer band | Coverage / honesty | Buildability |
| --- | --- | --- | --- | --- |
| **Smart / house-hacker** | **Net True Monthly Cost** = mortgage + tax + fees + insurance + capex − suite offset | NTMC-ceiling (degrade provenance when **imputed-dominated**) | suite offset ships as `imputed` (flat $1500); near-universal on price+tax+fees | **NOW** (only fully-now killer metric) |
| **Flippers** | **Flip Spread / MAO vs List** | MAO solve, labeled **scenario** (not a 2.1% halo) | ARV is **explicit user input** (value-add engine can't price a teardown); authed headline = **relist-corrected True DOM** | Detail-page **now**; market scan needs-infra |
| **Cashflow / landlord** | DSCR + cash-to-breakeven-down + vacant-vs-rent-controlled NOI gap | DSCR-ceiling (spine-inherited on price term only) | Coarse cap-rate discovery is a **FILTER not a blind sort** (`?? 0` bias); lead copy states the GTA truth, not an empty screen | Coarse filter **now** (6 floats already `sort:true`); landlord underwrite needs rent persisted |
| **Builders** | **Land Alpha — $/buildable-sqft vs ask** | Residual Land Value (geometry-dominated scenario) | **Detail-page analyst widget, NOT a 4th selector persona** until experiment B; lot-bearing minority only (`LotWidth ?? 0`) | Envelope geometry **now** on eligible subset; scan needs-data |

**The cleverest grounded insight (builders):** Toronto missing-middle GFA is **FSI-off-table** — the envelope is height + coverage + setbacks + depth, so buildable GFA is deterministic geometry from `LotWidth`/`LotDepth` (already indexed) **without a zoning bylaw**. Compliance-clean, defensible — but minority-coverage and un-backtested, hence detail-page-first.

### The 4 robustness fixes (what takes it from 0.72 → ~0.85)
1. **Cashflow discovery = filter, not blind sort** (cap_rate `?? 0` bias): add `has_rent_data`/`cap_rate_known` so the screen reads *"ranked among listings with a measured cap rate (N of M)."*
2. **Offer-band provenance degrades when imputed terms bind** — the 2.1% credibility applies only to `likelyClose`, never to a band dominated by the flat $1500 suite / 0.4% rent / `index:false` tax.
3. **Builder = detail-page widget, not a selector persona** until B resolves; remove the fiction `DENSITY READY` chip now.
4. **Anon IDX-legal proxy for the headline** — an *area-level* "homes here close at X% of ask (N sales)" aggregate, because the per-listing 2.1% number is VOW-gated and invisible to the exact audience the fame line must hook.

---

## 6. The two durable moats (survive a same-data competitor)

1. **The published 2.1% held-out error bar + VOW vault depth** for thin cohorts (accuracy). The cohort-ratio math itself is a weekend fast-follow; the *backtest credibility + vault depth* is the barrier.
2. **Relist-corrected True DOM** via the retained `property_hash` + 45/90-day campaign-gap stitch (`transformer.ts:318-383`) — unreproducible from a live feed without retained relist history.

"Incentive" (buy-side max-price advice a listing-supply business won't publish) is real **vs. HouseSigma/Realtor.ca specifically**, but collapses to "cleaner-scan" vs a buy-side-native entrant — so it must not carry headline weight.

---

## 7. The binding strategic constraint (E)

**100% of the differentiated product is VOW-gated.** The 2.1% spine and every authed killer number return `{}` to anonymous visitors (`sale-price/route.ts:48`). **You cannot be famous for a number no anonymous visitor can see.** Realized value therefore rides on whether the IDX-legal anon teaser converts — which makes fix #4 (anon area-level proxy) and the conversion instrumentation the highest-leverage items in the whole plan.

---

## 8. Phased implementation plan

**Compliance throughout (CLAUDE.md §4):** all deterministic arithmetic; no LLM on listing data; 100-listing UI cap honored (a sortable field sorts the full set server-side, but the UI still shows ≤100 — copy must say *"ranked view, max 100"*, never "the whole market"); brokerage displayed.

### Phase 0 — Honesty & foundation · **S · now · zero new data**
- Remove the §10 live violations: the unconditional `DENSITY READY` chip (`getAlphaFlag.ts:39`) and the "density-ready zoning" copy (`theRead.ts:97/99`).
- One `resolvePersona(scope, sources)`; make `personaFromProfile` total; plumb persona into the detail page + Compare (today hard-default `smart`).
- §4 CI gate: lint/test asserting no LLM-client import under `dealScore`/`property`/`persona`/`underwriting`/`worker`/**`discovery`** (note: `featureRegistry.ts` copy is currently outside any gate and overpromises persona-differentiation); snapshot tests over persona copy.
- Fix the `maxTaxes` 400 (index `TaxAnnualAmount` or remove the dead filter).

### Phase 1 — Lens-value contract + spine · **M · now**
- Define the typed `LensValue` + state machine + the **numeric** coverage-floor threshold (tie to the ~47% `cap_rate_est` reality).
- Wire `computeExpectedSale` as the shared anchor, carrying `spineScope` so the headline never silently shows the 11% AVM unlabeled.
- Persona-conditioned alpha flag (re-rank priority per lens).

### Phase 2 — Translators + offer bands · **M–L · now (smart) / shared module**
- `src/lib/persona/killerMetrics.ts` (one implementation, two consumers).
- Smart **NTMC-core** + NTMC-ceiling band; the **GTA closing/tax primitive** (Ontario + Toronto LTT + FTB rebate) feeding all buyer-side bands.
- Flipper Flip Spread/MAO (user ARV, labeled scenario) + authed True-DOM headline.
- Cashflow coarse **filter** + GTA-truth lead copy.
- Builder envelope **detail-page widget** (no selector slot yet).
- Re-target discovery tours per persona (the `tourForSurface` builder→`rail-color` mis-wire and the all-personas `listing-underwriting` terminal step are wrong for the new killer metrics).

### Phase 3 — Anon proxy + instrumentation · **M · now-ish**
- IDX-legal **area-level close-ratio aggregate** as the public face of the 2.1% headline (mitigates E).
- Lens-switch + killer-metric-engagement analytics on the existing discovery system → this *is* the harness that runs experiments A/B/E.

### Phase 4 — Tier-B discovery scan · **needs-infra · GATED on D + C**
- New nightly **cohort→Typesense precompute worker** (the missing stage) writing ~5 sortable floats (`ntmc/coc/dscr/flip_spread/land_alpha`) + persisted `annual_rent`/`match_tier`.
- **All-or-nothing per metric** (full recompute or serve the prior complete as-of snapshot — never a partial keyset stagger that biases a ranked set).
- Staging RAM/reindex dry-run before commit; per-band offer CI backtest gates the "calibrated" badge.

---

## 9. The empirical residue — the only path to 0.97

| # | Question | Cheapest signal |
| --- | --- | --- |
| **A** | Does a retail cashflow persona exist, or is it the house-hacker? | Lens-selection + suite-offset-engagement analytics (4–6 wks); defer the rent route until a pure-DSCR segment appears. |
| **B** | Do developers discover land by scanning live MLS? | Entry-path/referrer analytics on builder-persona detail opens; if scans are rare, don't fund the Tier-B land scan. |
| **C** | Do the flipper-MAO / builder-RLV bands calibrate? | Held-out backtests (MAO vs known flips, RLV vs built projects). The two spine-inherited bands need only a confirmatory check on the existing harness. |
| **D** | Does the precompute fit Typesense RAM + the window? | One staging index-growth dry-run + one spatial-precompute wall-clock run at prod scale. |
| **E** | Does the table-stakes anon teaser convert, given the spine is 100% VOW-gated? | Conversion analytics on the velvet-rope step with the area-level teaser live. **Highest leverage — gates 100% of realized value.** |

---

## 10. Appendix — verified code references
`expectedSale.ts:9` · `salePrice.ts:60-65` · `valueAdd/engine.ts` + `calibration.ts:6` (MIN_COHORT_N=30) · `api/avm/route.ts` · `api/estimates/sale-price/route.ts:44-48` (VOW gate) · `commandCenterStore.ts:265` · `dashboard/config.ts:22,170-175` · `fromListingDocument.ts:32` · `computeDealScore.ts:480` · `computeUnderwriting.ts:34,37,166,184` · `transformer.ts:318-383,856,888-889,1022-1023,1064,1085` · `typesenseSchema.ts:77,78,99-102,168` · `getAlphaFlag.ts:39` · `theRead.ts:97,99` · `featureRegistry.ts:475-491`.
