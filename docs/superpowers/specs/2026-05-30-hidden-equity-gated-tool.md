# Hidden Equity — Gated Member Tool (Design Spec)

**Date:** 2026-05-30
**Phase:** Value-Add Engine, Phase 2b (standalone tool — gated)
**Depends on:** Phase 1 engine (`src/lib/avm/valueAdd/`) + Phase 2a view-model (`forceAppreciationView.ts`), both shipped 2026-05-30.

---

## 1. Objective

A **signed-in-members-only** tool where a homeowner picks their neighbourhood + describes their home and gets (a) an estimated current market value and (b) a **Hidden Equity** report — the renovations that add the most value in *their* micro-market, ranked by value/cost/payback. Same deterministic engine as the on-listing card, consumer-framed, behind the Velvet Rope.

## 2. Why gated (compliance — the binding constraint)

Per the VOW agreement research (see memory `vow-public-display-constraint`): VOW-derived valuations may only be shown **behind the password-protected VOW gate**, to consumers with a bona-fide transaction interest, and may **not** be republished publicly or for a commercial purpose (§3.2 Purpose/Consumer/VOW; §6.2(a),(f); §6.3(k)). The deterministic/no-LLM engine satisfies CLAUDE.md §4 but does **not** by itself authorize public exposure. Therefore this tool is **members-only** and **must not be publicly launched until the Broker-of-Record / PROPTX signs off** — the disclaimer copy here is a first draft pending that review. No individual sold record/address/price is ever surfaced; only aggregate model output.

## 3. Non-goals (deferred or blocked)

- **Blocked (public):** OG share card, SEO neighbourhood pages, any anonymous access.
- **Deferred:** saved reports / Portfolio integration, address→community geocoding (user picks community), estimate-only (untrained) cohorts, multi-home comparison.
- No AVM-math, move-catalog, or calibration changes. No LLM (CLAUDE.md §4).

## 4. Scope of this build (v1)

Gated page + auth gate + modelable-cohort picker (API + pure builder) + valuation API (estimate + Hidden Equity report) + consumer report UI + mandatory disclaimers + **gating the existing open `/api/avm` and `/avm` page**.

## 5. Architecture & data flow

### 5.1 Route + auth gate
`src/app/(app)/hidden-equity/page.tsx` — **server component**. Calls `getCurrentUser()` (`@/lib/supabase/server`):
- **Unauthed →** render a "Velvet Rope" gated landing: a short value pitch + the existing `<MagicLinkForm />` (`src/components/auth/MagicLinkForm.tsx`) or a CTA to `/login`. No valuation UI, no API calls.
- **Authed →** render `<HiddenEquityTool />` (client container).

### 5.2 Modelable-cohort picker
New gated endpoint **`GET /api/avm/cohorts`** (returns 401 if `!getCurrentUser()`): returns the modelable tree `{ city → { community → types[] } }`, built by a **pure, tested** `buildCohortTree(rows, cityMap)` in `src/lib/avm/cohorts.ts`:
- Source: `SELECT city_region, property_sub_type, model_accuracy_score, total_sales_analyzed FROM avm_audit_report`.
- **Trained-only filter (v1):** keep cohorts with `model_accuracy_score >= 0.5 AND total_sales_analyzed >= 30` (the threshold where the value-add report actually prices moves; `COEFFICIENT_ENGINE_THRESHOLD` / `MIN_COHORT_N`). Estimate-only cohorts are a later expansion.
- **Normalize** each `city_region` with the existing `cityRegionLookupCandidates` logic (`src/lib/avm/normalizeType.ts`) to strip the legacy `^\d+\s*-\s*` / number+tag prefixes; **keep the raw `city_region` as the lookup key** so a selection round-trips to the cohort regardless of spelling (display label = normalized, value = raw).
- **Parent city** is NOT in `avm_audit_report` (keyed only by `city_region`+`property_sub_type`). Join it from listings: derive distinct `(city, city_region)` pairs (the `listings` table denormalizes `city`/`city_region`, migration 020). A community appearing under multiple cities is listed under each.
- `property_sub_type` is restricted to those present per community (Detached / Townhouse / Condo Apartment — **no Semi-Detached**, none exist in the data).
- Response cached (the cohort set only changes when `ingest-matrices.ts` reloads).

### 5.3 Valuation
New gated endpoint **`POST /api/avm/hidden-equity`** (401 if unauthed): validates the body, builds an `AVMInput`, then:
```ts
const estimate = await calculateAVM(supabase, input);          // existing
let valueAdd = null;
if (estimate.estimatedValue > 0) {
  valueAdd = await fetchValueAddReport(supabase, input, {       // Phase-1 engine
    subjectEstimate: estimate.estimatedValue,
    predSD: estimate.predictiveSD,                              // skips comps re-query
  });
}
return NextResponse.json({ estimate, valueAdd });
```
Uses the same P0-override + predSD seam built for the on-listing card. `supabase = getServiceRoleClient()` (RLS bypass for `raw_vow_sold`, same as `/api/avm`), but **only after** the `getCurrentUser()` auth check passes.

### 5.4 Gating the existing open endpoints (decision #1 — approved)
- `src/app/api/avm/route.ts`: add a `getCurrentUser()` check at the top → 401 when unauthed (closes the currently-open public valuation API).
- `src/app/(app)/avm/page.tsx`: gate identically (redirect/teaser) or point it at `/hidden-equity`. Pick the smallest change that removes anonymous access.

### 5.5 Client tool
- `src/components/hiddenEquity/HiddenEquityTool.tsx` — client container; holds form state (reuse `useAVMStore` or a local `useState`), calls the two APIs, renders form + report.
- `src/components/hiddenEquity/HiddenEquityForm.tsx` — the input form:
  - **Cascading picker:** Municipality `<Select>` → Community `<Select>` (filtered to that city's modelable communities) → Property type `<Select>` (only types that exist for that community). Loaded from `/api/avm/cohorts`.
  - **Home details:** beds / baths / parking / interior / exterior / basement tiers (reuse the labelled selects from `AVMPropertyForm.tsx`), **plus an optional square-footage `<Input>`** → `buildingAreaTotal` (the biggest accuracy lever; null when blank).
- `src/components/hiddenEquity/HiddenEquityReport.tsx` — consumer-framed result: the estimate headline + the Hidden Equity ledger. **Reuses `buildView`/`shouldRender`** from `forceAppreciationView.ts` for the move rows (DRY with the on-listing card); softer wrapper copy ("You could unlock ~$X in hidden equity"). When `valueAdd` is null / no priced moves, show the estimate + "renovation modeling isn't available for this neighbourhood yet" (shouldn't happen given the trained-only picker, but handle it).
- `src/components/hiddenEquity/Disclaimers.tsx` — the mandatory compliance block (always visible with any figure).

## 6. Compliance UI (mandatory — §6.3, §6.2(t))

The result screen always renders, verbatim-ish (pending Broker-of-Record review):
1. "This is an automated estimate generated from aggregate market data — **not an appraisal** or professional opinion of value."
2. "Information herein is **deemed reliable but is not guaranteed accurate by PROPTX**." (§6.3(i))
3. "The information provided herein must only be used by consumers that have a **bona fide interest** in the purchase, sale, or lease of real estate and may not be used for any commercial purpose or any other purpose." (§6.3(k))
- Do **not** attribute the value to TRREB/PROPTX as a source or imply affiliation (§6.2(t)). Do **not** show any individual sold record/address/price.

## 7. Testing (vitest, node-env — no jsdom)

Pure-logic only; UI/auth verified by `tsc` + `build` + manual.
1. `buildCohortTree` (`cohorts.test.ts`): normalization (strips `1001 - BR Bronte` → `Bronte`, keeps raw as key), trained-only filter (drops R²<0.5 / n<30), grouping `{city→community→types[]}`, no Semi-Detached, multi-city community handled, empty input → `{}`.
2. Any new consumer view-model/copy helper added in `hiddenEquity` (e.g. a headline formatter): unit-tested. Reuse of `buildView` is already covered by `forceAppreciationView.test.ts`.
3. The `hidden-equity` API request→input mapping (if a pure mapper is extracted) tested like `/api/avm` is.

## 8. Files

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/lib/avm/cohorts.ts` | pure `buildCohortTree` (+ types) |
| Create | `src/lib/avm/cohorts.test.ts` | builder unit tests |
| Create | `src/app/api/avm/cohorts/route.ts` | gated GET modelable tree |
| Create | `src/app/api/avm/hidden-equity/route.ts` | gated POST estimate + value-add |
| Create | `src/app/(app)/hidden-equity/page.tsx` | gated server page (teaser vs tool) |
| Create | `src/components/hiddenEquity/HiddenEquityTool.tsx` | client container |
| Create | `src/components/hiddenEquity/HiddenEquityForm.tsx` | cascading picker + details + sqft |
| Create | `src/components/hiddenEquity/HiddenEquityReport.tsx` | estimate + value-add (reuses `buildView`) |
| Create | `src/components/hiddenEquity/Disclaimers.tsx` | compliance notices |
| Modify | `src/app/api/avm/route.ts` | add `getCurrentUser()` 401 gate |
| Modify | `src/app/(app)/avm/page.tsx` | remove anonymous access (gate/redirect) |

## 9. Edge cases

- **Unauthed** → gated landing, zero VOW-derived data rendered or fetched.
- **Cohort with no estimate** (shouldn't pass the trained filter) → show estimate-unavailable message, no broken card.
- **Community under multiple cities** → listed under each; selection carries the raw `city_region` so the lookup is unambiguous.
- **Optional sqft blank** → `buildingAreaTotal: null` (feature mean-imputed, same as `/api/avm` today).
- **API failure/timeout** → friendly error; never 500 with internals.

## 10. Rollout

Ships behind the auth gate, **not publicly linked/launched** until Broker-of-Record/PROPTX sign-off on the gated-AVM approach + disclaimer copy. Verified by `npm test` + `tsc` + `lint` + `build`, plus a manual pass (signed-out → teaser; signed-in → pick a trained Brampton/Mississauga detached cohort → estimate + Hidden Equity report; confirm `/api/avm` now 401s when signed out).
