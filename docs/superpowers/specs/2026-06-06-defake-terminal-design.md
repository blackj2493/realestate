# De-fake the Terminal — Design Spec

**Date:** 2026-06-06
**Branch (planned):** `feat/defake-terminal` (off `main`, isolated — see §11)
**Status:** Approved design, pending spec review → implementation plan
**Strategy ref:** "Beat HouseSigma" Move B — never let the fake cap rate face one more user.

---

## 1. Problem

The Command Center terminal ranks, colors, filters, and scores listings off
`ExtrapolatedCapRate` — a **fabricated** flat-rent cap rate (100% coverage by
construction). The real, IDX-derived fields now exist in the live `properties`
collection and are referenced only as `??` fallbacks:

| Field | Meaning | Unit | Live coverage (For-Sale) |
| --- | --- | --- | --- |
| `cap_rate_est` | NOI ÷ price | percent | 34,703 / 73,671 = **47.1%** |
| `gross_yield_est` | annual rent ÷ price | percent | 35,275 / 73,671 = **47.9%** |
| `net_monthly_cashflow` | monthly cashflow | int $ | 100% non-zero, but **negative-carry for the ~53% with no rent** → a *confident fake* (see §4.2), NOT a "has estimate" signal |
| `ExtrapolatedCapRate` | **fake** flat-rent cap | percent | 100% (fabricated) |

(Counts verified live via `scripts/admin/_verifyYield.cjs` on 2026-06-06.)

The real fields are **sparse (~47%)** because the rent index suppresses thin
cohorts: `rentModel.ts` `MIN_COHORT_SAMPLES = 5`. So `cap_rate_est > 0`
already guarantees the rent cohort had ≥5 samples. The per-listing match tier
(`nbhd`/`city_bath`/`city`) and exact sample count are **not** carried onto the
Typesense doc — so a richer confidence gate is not achievable without a reindex.

**Three confident-fake numbers face users today, not one:** `ExtrapolatedCapRate`
(cap), the gross-yield fallback path, and `net_monthly_cashflow` (§4.2).

## 2. Goal

Repoint every user-facing surface from the fake field to the real
`cap_rate_est` / `gross_yield_est`, suppress the `net_monthly_cashflow` fake on
no-rent listings, protect the numbers against thin-cohort fallback error with a
render-time sanity band, flip the default persona to the Flipper beachhead, and
stop reading the fake field — all **without a reindex**.

## 3. Compliance decision (recorded deviation)

The "Beat HouseSigma" council consensus doc
(`docs/strategy/2026-06-04-beat-housesigma.md:53`) calls for **min-N ≥ 8** on a
publicly-shown yield cell, and item **D1** (line 74) specified the rent model
emit a dedicated `rent_idx_public` (IDX-only → public yield, min-N≥8) column.
**This spec deliberately ships at the rent index's baked-in N ≥ 5 floor**, on a
single blended column, public and ungated.

Rationale: `cap_rate_est` / `gross_yield_est` are **IDX-only** — the subject's
own list price × an aggregate of *active for-lease asking rents*, both already
publicly displayed. Cell-suppression exists to stop reverse-engineering
*confidential* records; that rationale barely applies to already-public asking
rents. Gating an IDX-only metric behind the VOW teaser would gate something that
was never VOW and would make Plan 4 a false prerequisite. The metric is **not
VOW-derived** and is therefore not subject to VOW display restrictions.

**Revisit at the next reindex:** add a per-listing rent-confidence / sample-count
field and implement the N ≥ 8 + tier split (Option 3) properly. The reindex path
is now resilient (PR #12 / commit `27c4a6b`: UUID checkpoint + 45s timeout), so
this is the natural moment. Tracked as deferred work in §9.

## 4. The render-time sanity band

A single shared module is the source of truth for plausible ranges:

```
src/lib/metrics/sanityBand.ts
  CAP_RATE_BAND    = { min: 1,   max: 15 }   // percent
  GROSS_YIELD_BAND = { min: 1.5, max: 18 }   // percent
  capRateOrNull(v): number | null       // returns v if in-band & > 0, else null
  grossYieldOrNull(v): number | null
  hasRentEstimate(doc): boolean         // cap_rate_est > 0 || gross_yield_est > 0
```

Bounds rationale: the band's real job is catching **tier-fallback mismatch at
the extremes** (a luxury home handed a coarse city rent → spuriously low; a cheap
unit handed a too-high comp → spuriously high). The median is already robust to a
single in-cohort outlier at N=5, so the residual noise lives at the extremes.
- Yield floor **1.5%** (not 2%) so a genuine low-yield luxury case ($2.4M home /
  $4k rent ≈ 2.0%) — exactly the "don't buy this for yield" signal a cashflow
  investor wants — is **not** censored. 2% would clip real signal.
- Upper bounds (cap 15 / yield 18) are where error-catching happens; internally
  coherent (cap ≈ yield − opex%, ~1.5–3 pts lower).

### 4.1 Field-level suppression, NOT row exclusion (critical)

An implausible `cap_rate_est` makes the **cell** invalid, not the **listing**.
The band therefore:
- **Display:** out-of-band / 0 / missing → render `—` (LedgerRow, mapMetrics,
  compare grid, dashboard tiles).
- **Sort (client-side):** out-of-band → treated as `null` → sinks to bottom.
- **Color (map):** out-of-band → excluded from the color scale (no fake hue).
- **Composite scores:** out-of-band → treated as absent (see §5).

**The band MUST NOT become a default global query filter.** A listing with a
garbage cap stays in the ledger with a `—` cap cell; it does not vanish. The band
bounds are folded into the Typesense `filter_by` **only when the user actively
filters or sorts by that metric** — so a cap-rate sort can't rank a 400% value at
the top, but the default unfiltered view still returns all rows.

### 4.2 Cashflow gate — forward-looking rule (no live surface today)

`net_monthly_cashflow` *would* be a confident fake on the ~53% no-rent rows
(`mortgage + tax + opex − $0 rent` = a confident red "−$3,200/mo"). **But verified
on origin/main it has NO live display/sort/filter surface** — `CashflowColumns`,
`FinancialProForma`, and the `queryBuilder` cashflow clause are all orphan. So the
rule is **forward-looking**: any future surface that shows/sorts/filters
`net_monthly_cashflow` (or `cashflow_floor`) MUST gate on **`hasRentEstimate(doc)`**
(→ `—` when false) and obey §4.1 (band-in-query only when active). The one live
cashflow-adjacent query is the dashboard `cashflowCount` (#12), de-faked via
`cap_rate_est`. `UnderwritingSandbox` stays out (live user recompute).
`hasRentEstimate` still ships in the §4 module so the rule is enforceable the
moment a cashflow surface is wired.

## 5. Composite-score correctness (the single biggest risk)

`computeDealScore` is **already correct**: it includes a component only when its
data is present and renormalizes weights over present components
(`computeDealScore.ts:13-16,244-251`), and the yield component is guarded by
`capRatePct > 0` (line 230). So a missing/zero cap is already excluded and the
remaining weights re-balance — missing data never tanks the score.

The gap is the **input path**. Both deal-score callers must feed **band-validated**
cap (null when missing *or* out-of-band), else an out-of-band 16% cap passes the
`>0` guard and clamps to max yield points:
- `fromListingDocument.ts:26` (terminal list + compare): `capRatePct = capRateOrNull(doc.cap_rate_est)`.
- `getListingDetail.ts:358` (listing detail page, see §6.1): feed
  `capRateOrNull(<real cap_rate_est>)`, NOT `proForma.extrapolated_cap_rate`.

Net: missing OR out-of-band cap ⇒ drop the component, renormalize. No `0`, no
garbage, no systematic penalty on the ~53% without an estimate. **Any other
persona score or blended metric that consumes cap rate gets the same treatment.**

## 6. Repoint inventory

Real-first, fake removed from the chain. Grouped by surface:

| Surface | File(s) | Change |
| --- | --- | --- |
| Ledger sort | `components/CommandCenter/columnSort.ts:57,59` | `cap_rate_est` / `gross_yield_est` first; band-aware null |
| Ledger cell | `components/CommandCenter/LedgerRow.tsx` | render real field via band guard → `—` when null |
| Deal score input (list) | `lib/dealScore/fromListingDocument.ts:26` | band-validated cap (§5) |
| Persona filter/sort/color/histogram | `lib/personas/personaConfig.ts` (cashflow + smart) | repoint `buildFilterString` (`cap_rate_est`), `sortBy`, `mapColor.metric`, control `field`; **smart `mapColor` domain `[0,0.08]`→`[2,8]`** (was the fraction scale for `targetGrossYield`); fix stale comments (13-19, 225-227) |
| Map metric | `lib/personas/mapMetrics.ts:53-56` | `field`+`metric` → `cap_rate_est` via band guard |
| Histograms | `lib/filters/histogram.ts:50-56` | add `cap_rate_est` (+ `gross_yield_est`); delete stale "EMPTY" comment |
| Compare grid | `lib/compare/compareMetricsConfig.ts:154-156` | `capRateVA` get → `capRateOrNull(c.listing.cap_rate_est)` (the live `capRateUw` underwrite row is untouched) |
| Dashboard | `lib/dashboard/queries.ts:63-68,127`, `boards.ts:51-61`, `components/dashboard/DashboardHeatTile.tsx:34` | repoint to `cap_rate_est` (+ `&& cap_rate_est:<=15`); **+ `(n with estimates)` qualifier** (§7) |
| Aggregates | `lib/bubbles/stats.ts:168,190,213-215` | `medianCapRate` → `cap_rate_est` + band; shift to real subset (§7). **NOT `region-stats/route.ts`** — Postgres column, deferred §14. |
| Watchlist | `lib/watchlist/useWatchlistSnapshot.ts:157` | `avgCapRate` → `capRateOrNull(cap_rate_est)`; dealScore flows via §5. (`computeUnderwriting.ts` is NOT a repoint — imports only `calculateMonthlyMortgage`; §9 engine-removal dep.) |
| **Listing detail page** | `lib/property/getListingDetail.ts:27,349,358` | see §6.1 |
| Tests | `lib/filters/terminalQuery.test.ts`, others | update expectations |

**Verified ORPHAN — explicitly NOT in scope** (no live importer; no `dynamic()`/`lazy()`): the entire `components/terminal/*` stack (`FinancialProForma`, `CashflowColumns`, `TerminalFilters`, `Builder/FlipperFilters`) + `lib/typesense/queryBuilder.ts` + `store/useFilterStore.ts`. Left as dead code (candidate for a separate deletion PR). **Consequence:** the §4.2 cashflow gate has no live target today (see §4.2); `net_monthly_cashflow` has no live display/sort/filter surface.

(`lib/typesense/client.ts:141`'s `ExtrapolatedCapRate?` is a type decl only —
leave for the §9 removal.)

### 6.1 Listing detail page (IN SCOPE, bounded)

The individual listing page is the highest-stakes financial surface (CLAUDE.md
§3C). `getListingDetail.ts:349` computes a **fake** `proForma` via
`calculateProForma` (from `ExtrapolatedCapRateEngine`) using only
listPrice/taxes/assocFee, and `:358` feeds `proForma.extrapolated_cap_rate` into
the deal score. The page reads the **raw IDX `full_payload` from Supabase**, which
does NOT carry the derived `cap_rate_est`.

Bounded fix:
- Fetch the listing's real `cap_rate_est` (+ `gross_yield_est`,
  `net_monthly_cashflow`) via a **Typesense point-lookup by listing key** (the
  page already does several async fetches; this hits Typesense, not a Supabase
  scan, so it is §12 Disk-IO-clean).
- Feed `capRateOrNull(real cap)` into the deal score (§5), **drop the
  `calculateProForma` / `ExtrapolatedCapRateEngine` import**.
- `capital_burn_rate_monthly` (if used downstream) comes from the doc's
  `CapitalBurnRateMonthly`, so the fake engine is fully removable from this path.

**Explicitly NOT in scope:** wiring the orphan `FinancialProForma` component (see
§14). This phase is "lookup + repoint + drop engine call," not a pro-forma rewrite.

## 7. Aggregate honesty

Repointed averages (e.g. region/dashboard "average cap rate") now average over
the **~47% with estimates**, a subset **biased toward comp-able property types**
— so the number shifts in **level, not just coverage**. Any headline cap-rate
tile MUST carry an **`(n = X with estimates)`** qualifier so it is not misread as
market-wide. Consistent with the de-fake honesty ethos.

## 8. Default persona flip — INCLUDED, but gated on an anon-field audit

Change `commandCenterStore.ts:226` `activePersona: "smart"` → `"flippers"`.
**Isolated as its own commit** (independently revertable).

**Spec gate (must pass before the flip commit lands):** flipping the *anonymous*
default to Flippers means logged-out users land in a view whose signature metrics
include **True DOM** (VOW-derived: built from `property_sale_history` relist
stitching), price-drop chain, and Capital Burn. `VOW_ENFORCE_TERMS` is still OFF
(that is Plan 4). The de-fake itself is Plan-4-independent (cap/yield are
IDX-only); **the persona flip is not** if the anon Flipper view renders/sorts/
colors by gated VOW fields.

**The council's own plan already classifies these fields.** Item **G**
(`2026-06-04-beat-housesigma.md:82`) defines the Flipper wedge as **gated
row-level True DOM / relist / Capital-Burn** + a **public aggregate teaser** +
the **safe single-listing price-drop number** on the anon card. So row-level True
DOM and Capital Burn — exactly the Flipper ledger's signature columns — are
**gated**, not anon-public, by the strategy's own line.

Preliminary finding (to be made definitive in implementation):
- An `isAuthed` gate already exists — `ListingTerminal.tsx` locks DealScore (422),
  AVM estimate (441), and Sale History (499, "VOW-gated; blurred for anonymous").
- True DOM is currently passed through **unlocked** to anon (line 495), and the
  *current* default persona (`smart`) **already surfaces row-level True DOM to
  anon**. So there may be a **pre-existing** exposure independent of this plan;
  the flip does not newly expose True DOM but makes it the primary sort + map
  color + adds Capital Burn prominence.

**Verification required before the flip commit:** audit every field the anon
Flipper ledger + map render/sort/color by; classify each IDX-public vs
VOW-derived against agreement §6.2(f), using item G as the strategy baseline.
- All anon-safe (price-drop, list price, public DOM only) → flip ships here.
- Row-level True DOM / Capital Burn surfaced to anon (likely, per item G) → the
  flip needs **field-level anon locks first** (blank/lock those columns for
  logged-out users), or it moves to Plan 4. This is a §6.2(f) breach risk, not a
  stylistic choice. **Note:** if the audit confirms the *current* `smart` default
  already leaks row-level True DOM to anon, that is a pre-existing compliance bug
  to flag separately — fixing it is out of scope here, but the flip must not
  deepen it.

## 9. Fake-field retirement — stop reading now, remove at next reindex

- **This plan:** make ALL UI (terminal **and** the listing detail page, §6.1)
  stop *reading* `ExtrapolatedCapRate` / `ExtrapolatedCapRateEngine`. End-of-plan
  gate: `grep -rE "ExtrapolatedCapRate" src/` returns only the type decl
  (`client.ts:141`) + the engine file/tests themselves — **zero functional reads**.
  The field stays in the index, dead but harmless.
- **Deferred to the next reindex** (coupled to a schema/index op the user is
  explicitly not paying for now): remove the `ExtrapolatedCapRate` column +
  `ExtrapolatedCapRateEngine` + `ExtrapolatedCapRateEngine.test.ts`, alongside
  adding the N ≥ 8 / confidence field from §3. Breadcrumb left here so it is not
  forgotten.

## 10. Optional (flagged, not a blocker)

Default-filter the **Cashflow persona** view to `cap_rate_est:>0` so its ledger
is a full list of real-yield listings rather than ~half `—` (which reads as
broken to the destination persona). Implement as a per-persona default toggle,
not a hard filter. Decide during implementation.

## 11. Branch / workspace isolation

**Heads-up — shared working tree with a concurrent session.** During this
session `src/lib/avm/anchorService.ts` went from modified → clean and a new
untracked `avm-backtest-smoke.json` appeared, i.e. another session/process is
actively working in this tree. Current tracked WIP is **only** `src/app/apply/page.tsx`.

Because a branch *switch* would yank the shared tree out from under that session,
**isolate via a dedicated git worktree** for `feat/defake-terminal` (off `origin/main`)
rather than stash + in-place switch. The untracked spec
(`docs/superpowers/specs/2026-06-06-defake-terminal-design.md`) and
`scripts/admin/_verifyYield.cjs` must be carried into the worktree. (Fallback only
if no concurrent session: path-scoped `git stash push -- src/app/apply/page.tsx`
then branch — never `git stash -u`, which would sweep the spec + script.)

## 12. Verification & tests

- `scripts/admin/_verifyYield.cjs` — pre/post field-population sanity check.
- New unit tests (vitest, **node-env, pure logic** — no render): `sanityBand`
  bounds + null behavior; `hasRentEstimate`; `fromListingDocument` band-validated
  deal-score input (missing → component dropped; out-of-band → dropped; in-band →
  included).
- Per-phase gate: `npx tsc --noEmit` + `npm run lint` + `npm test`.

## 13. Commit plan (concern-separated)

1. `feat(metrics): sanity band + hasRentEstimate module + tests` (`lib/metrics/sanityBand.ts`).
2. `fix(dealscore): band-validated cap input, drop missing/out-of-band component`.
3. `feat(terminal): repoint ledger/map/histogram/persona to real cap+yield` (no flip; drop the yield-cell `*100` unit bug).
4. `feat: repoint downstream surfaces (compare, dashboard +n-qualifier, aggregates, watchlist, underwriting)`.
5. `feat(listing): de-fake detail-page deal score — real cap via Typesense lookup, drop fake engine` (§6.1).
6. `feat(terminal): default persona smart→flippers` — **isolated**, gated on §8 audit.
7. `chore: drop stale ExtrapolatedCapRate comments + update tests`.

## 14. Out of scope

- Reindex of any kind. Removal of the fake field/engine (deferred, §9).
- N ≥ 8 / confidence / tier split (deferred, §3).
- **`api/market/region-stats/route.ts`** — reads a persisted Postgres
  `ExtrapolatedCapRate` column (`getServiceRoleClient`, not Typesense); de-faking
  needs a `cap_rate_est` Postgres column = reindex/migration-shaped. Deferred
  (revisit with the §9 reindex).
- **Wiring the orphan `FinancialProForma` component** — it already expects real
  fields but is referenced nowhere in `src/`; integrating it is a separate
  feature, not a de-fake. (If ever wired, it must obey the §4.2 cashflow gate.)
- `UnderwritingSandbox` cashflow (live user recompute, §4.2).
- Plan 4 (VOW_ENFORCE_TERMS, migration 029) — only becomes a dependency if §8
  audit fails.
