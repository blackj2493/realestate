# QA Plan C1 — Data Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the surviving medium/low audit findings where the platform shows WRONG NUMBERS: M-6 (True DOM label lies), M-7 (ingester drops last sold page), M-8/M-10/M-23 (price-trend broken for multi-word regions + capped at 1,000 rows + `%` injection), M-9 (AVM sibling donor loss), M-11 (leases render as "Sold"), M-12 (Gross Yield inflated by hypothetical suite income), plus quick wins M-13, M-18, LOW-10, LOW-11.

**Architecture:** Pure-logic fixes get TDD; the ingester sentinel fix is mechanical (no test harness exists for it — verified by typecheck + careful diff). The price-trend fix consolidates three findings into one rewrite of its query block (validate input → quote `.or()` values → paginate). M-11 widens the `CampaignStatus` union with `'Leased'` — TypeScript's `Record<CampaignStatus, …>` color maps make the compiler enumerate every consumer.

**Decisions locked with the user:** M-12 → headline Gross Yield becomes RENT-ONLY (industry definition); suite income stays in the income/NOI lines and gets its own labeled display.

**Branch:** `fix/qa-mediums-data` cut from `origin/main` (PRs #26/#27 merged 2026-06-11). Windows: `npm.cmd`/`npx.cmd`. Never stage audit/, docs/, .claude/, scripts/admin/_*.ts, _migration031.sql.

**File structure:**
- Modify: `src/components/CommandCenter/ListingTerminal.tsx` (~471-476)
- Modify: `scripts/worker/ingester.ts:1048,1185`
- Modify: `src/app/api/market/price-trend/route.ts` (query block + GET validation)
- Modify: `src/lib/avm/siblingModel.ts` (~55-62)
- Modify: `src/lib/campaignHistory/types.ts`, `normalize.ts`, `timeline.ts` + consumers found by typecheck (KIND_COLOR maps etc.); extend `normalize.test.ts`/`timeline.test.ts`
- Modify: `src/lib/underwriting/computeUnderwriting.ts:129` + `src/components/Property/UnderwritingSandbox.tsx` label; extend/create its test
- Modify: `src/lib/typesense/ExtrapolatedCapRateEngine.ts` docstring, `src/components/Property/CampaignHistorySection.tsx:18`, `scripts/worker/services/financialMetrics.ts` (zero-price guard) + its test, `src/lib/property/getListingDetail.ts:152`

---

### Task 0: Branch + baseline

- [ ] `git status --short` (tracked modifications → STOP and ask) · `git fetch origin` · `git checkout -b fix/qa-mediums-data origin/main` · if typecheck errors mention `.next/types`, `Remove-Item -Recurse -Force .next` first · `npm.cmd run typecheck` + `npx.cmd vitest run` → record baseline count; STOP if red.

### Task 1: M-6 — Asset Summary "True DOM" renders the stitched value

**Files:** `src/components/CommandCenter/ListingTerminal.tsx`

Line ~188 defines `dom` (unstitched `calculatedDOM`); line ~190 defines `trueDom = priceTimeline?.trueDom ?? dom` (stitched). The Asset Summary card at ~471-476 is LABELED "True DOM" but renders `{dom}` and colors thresholds on `dom`. The DOMTimelineChart below already uses `trueDom` correctly.

- [ ] **Step 1:** Read lines 180-200 and 460-500. In the Asset Summary card cell ONLY, replace every use of `dom` with `trueDom` (the displayed value AND the color-threshold expression). Do not touch other uses of `dom` in the file.
- [ ] **Step 2:** Typecheck + full suite (no render test possible — node env). Grep the card's JSX to confirm zero remaining `dom` references between the "True DOM" label and the cell's closing tag.
- [ ] **Step 3:** Commit: `fix(terminal): Asset Summary 'True DOM' now renders the stitched trueDom, not raw calculatedDOM` (+ body: `The label promised relist-corrected DOM but showed the unstitched value, undercounting on exactly the relisted properties the metric exists for. Resolves audit MEDIUM-6.` + Co-Authored-By line).

### Task 2: M-7 — ingester pagination honors @odata.nextLink

**Files:** `scripts/worker/ingester.ts`

Both fetchers already return `nextLink` (`fetchActiveListingsBatch` :492, `fetchSoldListingsBatch` :570) but the loops ignore it: a 99-record final page with more data behind it (deleted record, server-side limit) ends pagination early.

- [ ] **Step 1:** Line 1048: `activeHasMore = batch.listings.length === 100;` → 

```ts
      // nextLink is the authoritative "more pages" signal; the ===100 heuristic stays
      // as a fallback for endpoints that omit nextLink (the /Media endpoint does — see
      // memory media-reconciliation-gap). Resolves audit MEDIUM-7.
      activeHasMore = batch.nextLink != null || batch.listings.length === 100;
```

- [ ] **Step 2:** Line 1185: `soldHasMore = !hitOldCutoff && batch.listings.length === 100;` →

```ts
      soldHasMore = !hitOldCutoff && (batch.nextLink != null || batch.listings.length === 100);
```

- [ ] **Step 3:** Typecheck + full suite. There is no ingester test harness — the change is two boolean expressions; verify by reading the diff (`git diff scripts/worker/ingester.ts` must show exactly those two lines + comment).
- [ ] **Step 4:** Commit: `fix(etl): ingester pagination trusts @odata.nextLink — no more dropped final sold pages` (+ audit MEDIUM-7 reference + Co-Authored-By).

### Task 3: M-8 + M-10 + M-23 — price-trend: validate, quote, paginate

**Files:** `src/app/api/market/price-trend/route.ts`

Three defects in one route: (a) `safe` keeps internal spaces → PostgREST `.or()` parses unquoted spaced values as malformed → ZERO results for every multi-word neighbourhood; (b) `%`/`_` pass through → full-table-scan vector; (c) `.limit(20000)` silently capped at 1,000 → oldest months under-reported in big cities.

- [ ] **Step 1: Input validation in GET (reject, don't sanitize-and-guess).** After `const region = (params.get("region") || "").trim();` add:

```ts
  // Letters/digits/spaces/hyphen/apostrophe/period only — matches every real GTA
  // municipality & community name and excludes PostgREST/ilike metacharacters
  // (% _ , ( ) ") outright. Resolves audit MEDIUM-23.
  const REGION_RE = /^[\p{L}\p{N}\s\-'.]{1,60}$/u;
  if (region && !REGION_RE.test(region)) {
    return NextResponse.json({ error: "Invalid region" }, { status: 400 });
  }
```

- [ ] **Step 2: Quote the `.or()` values** so multi-word regions parse. In `computeTrend`, replace lines 84 + 90:

```ts
  // PostgREST .or() requires double-quoted values when they contain spaces —
  // unquoted, "Vales of Castlemore North" is a parse error and silently matches
  // nothing (audit MEDIUM-8). Input is already validated against REGION_RE, which
  // excludes the quote character itself.
  const safe = region.trim();
  …
    .or(`city.ilike."${safe}",city_region.ilike."${safe}"`)
```

- [ ] **Step 3: Paginate past the 1,000-row cap.** Replace the single `.limit(MAX_ROWS)` execution (lines 111-115) with a paged loop. The filters are built per-page (PostgREST builders are single-use), so extract a builder closure:

```ts
  const PAGE = 1000; // PostgREST hard cap per response
  const buildQuery = () => {
    let q = sb
      .from("raw_vow_sold")
      .select("close_price, list_price, purchase_contract_date, building_area_total")
      .or(`city.ilike."${safe}",city_region.ilike."${safe}"`)
      .gte("close_price", 50000)
      .gte("purchase_contract_date", cutoff.toISOString());
    const variants = variantsForKeys(typeKeys);
    if (variants.length) q = q.in("property_sub_type", variants);
    if (minBeds > 0) q = q.gte("bedrooms_above_grade", minBeds);
    if (minBaths > 0) q = q.gte("bathrooms_total_integer", minBaths);
    if (minParking > 0) q = q.gte("parking_total", minParking);
    if (minFrontage > 0) q = q.gte("lot_width", minFrontage);
    return q;
  };

  type Row = { close_price: unknown; list_price: unknown; purchase_contract_date: unknown; building_area_total: unknown };
  const rows: Row[] = [];
  for (let from = 0; rows.length < MAX_ROWS; from += PAGE) {
    const { data, error } = await buildQuery()
      .order("purchase_contract_date", { ascending: false })
      .order("listing_key") // deterministic tie-break across pages
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
```

then iterate `rows` instead of `data ?? []` below (loop body unchanged). Keep the original comments (move them onto the builder). Bump the cache version: `"v7"` → `"v8"` in the `unstable_cache` key array (the result shape is the same but values change — stale 1,000-row caches must not survive).

- [ ] **Step 4: Tests.** Create `src/app/api/market/price-trend/route.test.ts` — mock `@/lib/auth/requireConsumer` (`getConsumer` → `{ isConsumer: true }`), `@/lib/supabase/client` with the chainable slice-returning stub pattern (copy from `src/app/sitemap.test.ts`), and `@/lib/dashboard/propertyTypes` (`variantsForKeys: () => []`, `parseTypeKeys: () => []`). Note `unstable_cache` from next/cache passes through in the test env (it executes the wrapped fn) — if it doesn't, mock `next/cache` with `unstable_cache: (fn) => fn`. Three tests: (1) `region=%25` (a `%`) → 400, supabase never constructed; (2) multi-word region → the `.or()` argument captured by the stub contains `city.ilike."Vales of Castlemore North"` (quoted); (3) 2,500-row dataset → stub's `range` called ≥3 times and the returned points reflect all rows. Write tests FIRST where practical (test 1 and 2 fail against current code; paste output), implement, re-run.
- [ ] **Step 5:** Full suite + typecheck. Commit: `fix(market): price-trend — validate region, quote .or() values, paginate past PostgREST 1k cap` (+ body noting all three audit IDs MEDIUM-8/10/23 + cache bumped to v8 + Co-Authored-By).

### Task 4: M-9 — siblingModel collects ALL distinct communities

**Files:** `src/lib/avm/siblingModel.ts`

`.limit(5000)` at :59 is silently capped at 1,000 non-distinct rows; communities past row 1,000 vanish from the donor set, silently degrading untrained-cohort AVM in big cities.

- [ ] **Step 1:** Replace the single read (~lines 55-62, the `regionsRes` query + Set) with a paged loop (PAGE=1000, `.order("city_region")` for determinism, accumulate into the existing `Set`, break on partial page, hard stop after 20 pages as an IO-budget guard with a `console.warn`). Keep the function's signature/return unchanged.
- [ ] **Step 2:** If `src/lib/avm/siblingModel.test.ts` exists, extend it with a paging test (chainable stub, 1,500 rows across 2 pages → Set contains communities from both); if it doesn't exist, create it with that one test using the established stub pattern. TDD: fail-first against the unpaged code.
- [ ] **Step 3:** Full suite + typecheck. Commit: `fix(avm): siblingModel pages past the PostgREST 1k cap — no more silently dropped donor communities` (audit MEDIUM-9 + Co-Authored-By).

### Task 5: M-11 — leases stop masquerading as "Sold"

**Files:** `src/lib/campaignHistory/types.ts`, `normalize.ts`, `timeline.ts`, `src/components/Property/CampaignHistorySection.tsx`, plus every consumer the compiler flags; extend `normalize.test.ts` + `timeline.test.ts`

`mapStatus` maps `MlsStatus='leased'` → `'Sold'` (normalize.ts:42); investors see phantom "Sold" events whose "price" is monthly rent.

- [ ] **Step 1 (failing tests first):** In `normalize.test.ts` (read it; reuse its fixtures): `mapStatus(undefined, 'leased')` → `'Leased'`. In `timeline.test.ts`: a Lease campaign with `status: 'Leased'`, `end_date`, `close_price: 2400` produces a terminal row with `kind: 'Leased'` and `price: 2400`, and NO row with `kind: 'Sold'`. Run — both fail (no 'Leased' variant).
- [ ] **Step 2:** `types.ts`: `CampaignStatus = 'Active' | 'Terminated' | 'Expired' | 'Suspended' | 'Sold' | 'Leased'`.
- [ ] **Step 3:** `normalize.ts`: line 42 becomes two lines — `if (m === 'leased') return 'Leased';` and `if (s === 'closed' || m === 'sold') return 'Sold';`. CAREFUL: `StandardStatus='Closed'` covers BOTH sold and leased deals — refine: `if (m === 'leased') return 'Leased';` first, then `if (s === 'closed' || m === 'sold') return transaction-agnostic 'Sold'` stays as-is (a Closed lease without MlsStatus='Leased' still maps to Sold — acceptable residual, note it in a comment). `resolveEndDate`: add `case 'Leased': return strOrNull(raw.CloseDate) ?? strOrNull(raw.PurchaseContractDate);` (mirrors Sold).
- [ ] **Step 4:** `timeline.ts`: add `'Leased'` to `TimelineEventKind`; in `buildEventRows`'s terminal-row push, the price line `e.status === 'Sold' ? e.close_price : null` becomes `e.status === 'Sold' || e.status === 'Leased' ? e.close_price : null`.
- [ ] **Step 5:** Run `npm.cmd run typecheck` — let the COMPILER find every `Record<CampaignStatus|TimelineEventKind, …>` map missing the new keys (KIND_COLOR in CampaignHistorySection.tsx, any STATUS tone maps in `src/components/Property/CampaignHistory*`). Add `Leased` entries with the sky/lease tone (`text-sky-300` — matching the existing lease-bar color language). For non-Record switch/ternary consumers, Grep `'Sold'` within src/lib/campaignHistory and src/components/Property and audit each hit for whether Leased needs the same branch (e.g. trueDom.ts ignores status except 'Active' — no change). Report every consumer touched.
- [ ] **Step 6:** All tests green (the Step 1 tests + the suite), typecheck clean. Commit: `fix(history): leases end as 'Leased', not phantom 'Sold' events priced at monthly rent` (audit MEDIUM-11 + Co-Authored-By).

### Task 6: M-12 — Gross Yield headline is rent-only

**Files:** `src/lib/underwriting/computeUnderwriting.ts`, `src/components/Property/UnderwritingSandbox.tsx`; test file for computeUnderwriting (extend if exists, else create)

`grossYieldPct` uses `grossMonthlyIncome` (rent + `otherIncome`, which is pre-seeded $1,500 hypothetical suite income when `hasSuitePotential`) — a 50% overstatement on the headline.

- [ ] **Step 1 (failing test first):** with `monthlyRent: 3000, otherMonthlyIncome: 1500, purchasePrice: 1_000_000` (other inputs minimal), assert `grossYieldPct === 3.6` (rent-only: 3000×12/1M) — fails at 5.4 today. Keep a second assertion that `grossMonthlyIncome` still includes otherIncome (4500) so NOI/cashflow semantics are unchanged.
- [ ] **Step 2:** Line 129: `const grossYieldPct = price > 0 ? (monthlyRent * 12 / price) * 100 : 0;` with comment `// Industry definition: annual gross RENT / price. otherIncome (e.g. hypothetical suite) stays in NOI/cashflow but must not inflate the headline yield (audit MEDIUM-12).`
- [ ] **Step 3:** In `UnderwritingSandbox.tsx`, find the "Gross Yield" label (~line 175): relabel to `Gross Yield (rent)`. Where `otherMonthlyIncome > 0`, the income section already shows the line items — verify the suite income line is visibly labeled (e.g. "Other income (suite est.)"); if the label is just "Other income", append "(suite est.)" when the value came from the suite seed is NOT knowable at render — leave the generic label, it's user-editable.
- [ ] **Step 4:** Suite + typecheck. Commit: `fix(underwriting): Gross Yield headline is rent-only — hypothetical suite income no longer inflates it 50%` (audit MEDIUM-12 + Co-Authored-By).

### Task 7: Quick wins — M-13, M-18, LOW-10, LOW-11

**Files:** `src/lib/typesense/ExtrapolatedCapRateEngine.ts`, `src/components/Property/CampaignHistorySection.tsx`, `scripts/worker/services/financialMetrics.ts` (+ its test), `src/lib/property/getListingDetail.ts`

- [ ] **Step 1 (M-13):** docstring at ExtrapolatedCapRateEngine.ts:183-188 — correct the three @example values to `total_capital_basis = 1012500`, `pro_forma_noi = 47025`, `extrapolated_cap_rate = 4.64` (the runtime code is correct; only the example lies).
- [ ] **Step 2 (M-18):** `CampaignHistorySection.tsx:18` — add `timeZone: 'UTC'` to the `toLocaleDateString('en-US', {...})` options, with comment `// Date-ONLY strings parse as UTC midnight; without timeZone:'UTC' every UTC− viewer (all of Ontario) sees the previous day (audit MEDIUM-18).`
- [ ] **Step 3 (LOW-10, TDD):** in `financialMetrics.test.ts` add: input with `calculation_price: 0, listPrice: 0` → every returned ratio metric is 0 (`cap_rate_est`, `cap_rate_floor`, `gross_yield_est`, `tax_burden_ratio`) and `net_monthly_cashflow === 0`. Run (fails — `price||1` yields astronomical values). Implement: at the top of the OPEX section in `calculateFinancialMetrics`, after price resolution, add an early return of a fully-zeroed `FinancialMetrics` object (every field 0 / `'UNASSESSED'`) `if (!(price > 0) || !(listPrice > 0))`, with comment referencing audit LOW-10. Re-run.
- [ ] **Step 4 (LOW-11):** `getListingDetail.ts:152` — `Math.ceil(diff / 86_400_000) - 1` → `Math.floor(diff / 86_400_000)` with comment `// floor matches trueDom's day math; ceil−1 under-reported exact-boundary days (audit LOW-11).`
- [ ] **Step 5:** Suite + typecheck. ONE commit: `fix(data): quick wins — cap-rate docstring, UTC date render, zero-price metric guard, DOM day-boundary` (audit MEDIUM-13/MEDIUM-18/LOW-10/LOW-11 + Co-Authored-By).

### Task 8: Final gate + PR

- [ ] typecheck · lint (0 errors, no new warnings in touched files) · full suite · build. Runtime smoke: `/api/market/price-trend?region=Vales%20of%20Castlemore%20North` returns points (was empty) for a signed-in consumer OR at minimum non-500 locked shape anon; `region=%25` → 400.
- [ ] Push `fix/qa-mediums-data`, PR to main titled `fix: QA-audit data-truth mediums (True DOM label, ingester pagination, price-trend, AVM siblings, Leased status, rent-only yield)` with the finding→fix table; note the price-trend cache bump (v8) and that corrected trend data appears as caches expire (≤24h). Standard attribution.
