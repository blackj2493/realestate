# R1 — product-ux (Cross-examination)

I read all six R0s. Two of them (`data-quant`, `persona`) moved me materially. One collision the lead flagged (sequencing) I'm **conceding the headline of** — but with a sharpening that makes my thesis *stronger*, not retired. Below: the three flagged collisions, then a direct challenge.

---

## 1. SEQUENCING — does data-quant's rent model outrank my "fix leaky surfaces first"? **Partial concede, with a merge.**

`data-quant` is right and I was incomplete. I argued "distribution > more metrics." But `data-quant` proved (R0 §B6-7, live-verified) that the metrics aren't merely *under-distributed* — the cashflow spine is **fake**: `rental_market_index` / `city_region_avg_price` / `municipal_mill_rates` all **404** → `gross_yield_est`/`cap_rate_est`/`net_monthly_cashflow` are 0 or negative; and the one populated field, `ExtrapolatedCapRate`, is `f(ListPrice)` with a static **$5,500/mo rent, $120k capex** for every property (`ExtrapolatedCapRateEngine.ts:61-92`). `persona` corroborated: the Cashflow "Yield" column is a misnomer re-displaying cap rate (`personaConfig.ts:276`).

This **reframes my own finding, it doesn't refute it.** My R0 said the trust spine is leaky (dead watchlist heart `LedgerRow.tsx:107,159`, dead drawer CTAs `ListingTerminal.tsx:527-532`, bucket-sqft-as-truth `:336`). data-quant just found the *worst* leak of all, and it's upstream of the UI: **the ledger's cap-rate/yield columns render a fabricated number to the exact analytical user who will check the math and never return** (data-quant's "credibility landmine," persona's "fake in 60 seconds"). A dead button says "this product is unfinished." A *plausible-but-fake* cap rate says "this product is lying." The second is fatal; the first is merely bad.

**So I revise my ordering. Concrete sequence:**

1. **P0 — Stop displaying fake numbers (this week, UI-only, no data dependency).** Until the rent model lands, the cap-rate/yield columns and the persona "Yield" field must either (a) show "—" with a "rent model coming" affordance, or (b) be replaced in the Cashflow column set by something *real and populated* (True DOM, price drop, Deal Score — all verified live by data-quant/competitive). This is a 1-file change to `personaConfig.ts` column defs + the `LedgerRow.tsx:51-57` cap/yield cells (which already fall back to `—`, so it's mostly removing the fake `ExtrapolatedCapRate` source). **This costs nothing and removes the credibility landmine immediately** — it's the cheapest, highest-trust action in the entire council's backlog.
2. **P1 — data-quant MOVE 1: build the rent model** from owned For-Rent IDX + leased VOW (their estimate: lights up `financialMetrics.ts` with zero new engine code). This is the real spine. It outranks my cosmetic trust-spine fixes.
3. **P1 (parallel, no conflict) — my trust-spine fixes**: wire the real `WatchButton`/`useWatchlistStore` into `LedgerRow` + `ListingTerminal` (the working component already exists — `WatchButton.tsx`, used correctly in `ListingActions.tsx:48-69`); kill dead `highlightNLPFlags` (`ListingTerminal.tsx:63-87`); label bucket-sqft. These touch *different files* than the rent model — they run concurrently, not after.
4. **P2 — Sandbox-as-front-door + mobile** (below).

**Net:** I concede "distribution > metrics" as stated was wrong *for the fake-cashflow case*. The corrected thesis: **stop lying first (P0, free), build the real number second (P1, data-quant owns), distribute it everywhere third.** data-quant's rent model is on the critical path; my surface fixes flank it, they don't gate it.

---

## 2. MOBILE — prerequisite for an "instant hit," or fast-follow? **Fast-follow. I concede the launch-sequence point to `persona`/`data-quant`, and I'll defend *why* mobile still can't be cut entirely.**

`persona` (cut to cashflow beachhead) and `data-quant` (fix data first) are both right that **mobile is not the thing that makes us an instant hit at launch.** An instant hit with the top-1% Cashflow Investor is a *real per-property cap rate + a map that re-colors by your own cash-on-cash* (persona's Move 1 = data-quant's Move 1 = my Sandbox-as-front-door, all three converge). That magic is desktop-first by nature — underwriting 40 doors/month happens at a desk. **So Pocket Terminal drops below the data spine in priority. Concede.**

But two things keep it from being cut to zero:
- **`competitive` R0 §2.2 flagged "our mobile story is unverified" as a deficit vs HouseSigma's ~2M-MAU app.** I verified it: it's not unverified, it's **absent** — grep for any responsive/touch primitive in `CommandCenter/` = 0 matches; resize is mouse-only (`page.tsx:119-137`); the layout is a hard side-by-side (`:272`). So when `growth`'s "flip the funnel" lands (drop anon users into `/properties`) and `growth`'s Move-3 SEO/forum links start sending traffic, **a meaningful fraction of that hard-won top-funnel arrives on a phone and hits a wall.** A broken mobile experience doesn't just fail to convert — it burns the acquisition `growth` paid for.
- The fix is cheaper than I implied. The **minimum viable mobile** isn't the full Pocket Terminal; it's a `lg:` breakpoint that, below it, renders a Map/List **toggle** (one view at a time) instead of side-by-side, and pointer-events on the resize handle. That's a layout-CSS change to one file, not a rewrite.

**Revised position:** Mobile = **fast-follow, scoped to "don't hit a wall"** (responsive toggle), shipped *alongside or just after* the funnel-flip so we don't pour `growth`'s traffic into a desktop-only door. The full bottom-sheet underwriting Pocket Terminal is a later phase once the cashflow beachhead is proven. I'm dropping it from "boldest move #1" to a launch-gating *floor*, not a *feature*.

---

## 3. perf-arch's listing-page ISR/cache — **BACK IT, hard. It's the shared dependency under my trust-spine and growth's whole funnel.**

`perf-arch` R0 §C/Move-2 is the most important infra finding for my mandate and I'm fully behind it. `/properties/[id]/page.tsx:36` is `force-dynamic` with a per-request fan-out: `select("*")` detoasting full JSONB (`getListingDetail.ts:186-194`), a **live external ProptX `/PropertyRooms` call inside SSR** (`:154-176`), plus synchronous AVM/Deal-Score compute. This is:
- **The page my own drawer's "Open Full Report" button leads to** (`ListingTerminal.tsx:506-512`) — every high-intent click lands on the uncached path.
- **The page `growth`'s flipped funnel + SEO sends all anon traffic to** (`growth` R0 §2: 45k indexable pages).

If we flip the funnel (growth) and don't cache the listing page (perf-arch), we've engineered a self-DoS that *also* tanks Core Web Vitals → kills the SEO ranking growth depends on. **perf-arch's Move 2 (ISR + `unstable_cache` + pre-ingest rooms into `full_payload` at ETL so SSR never hits ProptX) is a hard prerequisite for both growth's funnel-flip and my "Open Full Report" being a good experience.** I'll co-sign it in R2 as P1.

One add from my side: perf-arch's "select only needed columns" must be reconciled with what the **drawer** hydrates (`ListingTerminal.tsx:163` calls `/api/property/${id}`, also `force-dynamic` per perf-arch §C). Both the drawer's API and the full page share `getListingDetail` — caching it once fixes both surfaces I own.

---

## Where the council is converging (worth naming so we don't re-litigate in R2)

**One feature keeps getting independently re-derived by four of us** — it should be the council's lead recommendation:

> **"Underwrite the whole map":** precompute a *real* per-listing cash-on-cash / cashflow at index time (`computeUnderwriting` already exists) against data-quant's new rent model, store `coc_at_20pct`/`cashflow_at_20pct` as populated Typesense fields, and let a top-bar leverage control (down% / rate / rent) re-color the map and re-sort the list live.

- `persona` Move 1 (explicitly this).
- `data-quant` Move 1 (the rent model that makes it real) + the empty `cashflow`/`yield` fields it fills.
- my R0 Move 2 (Sandbox-as-front-door, pushed from the 30% rail to the map).
- `competitive` Move 3 (the self-serve underwriting wedge HouseSigma's brokerage model forbids).

That's the beachhead's magic moment. It is **compliance-clean if the rent model is sourced from VOW leased data** (compliance R0 §3 limit #2: a metric derived *only* from active IDX has no carve-out — so `data-quant`, source the rent table from **VOW leased records**, not only For-Rent IDX, or the whole map-recolor metric is IDX-derived and forbidden by IDX §6.2(f)). **Flagging this for `data-quant` + `compliance` — it changes the data source for the council's flagship feature.**

---

## My direct challenge → `growth` (sent as a message too)

`growth` Move 1 ("flip the funnel: drop anon users into the terminal") is right in spirit and I want it — it directly fixes my R0 finding #6 (no first-run TTV). **But as drawn it ships traffic into two walls I and perf-arch documented:**

1. **The terminal is desktop-only** (my finding #1; competitive's "unverified mobile"). Forum/SEO links skew mobile. Flipping the funnel *before* the responsive toggle exists pours your hard-won top-funnel onto a broken phone layout.
2. **The listing page anon users land on is uncached `force-dynamic`** (perf-arch §C). Your SEO play (Move 3) drives crawlers + viral links to a page that recomputes a full AVM + a live ProptX call per hit. That's a scale bomb *and* it tanks the CWV that your SEO ranking needs.

**My challenge:** sequence your funnel-flip to land *after* (a) the P0 fake-number kill (or your "cap-rate-on-list" teaser shows the same fabricated `ExtrapolatedCapRate` to every new anon visitor — the worst possible first impression), (b) perf-arch's listing-page ISR, and (c) the minimal responsive toggle. Otherwise the funnel-flip converts *worse*, not better, and burns the credibility we're trying to build with exactly the analytical audience we want. Concede the gating, or show me why fake-cap-rate-on-first-touch doesn't poison the well.

---

## Concessions log
- **Conceded to `data-quant`:** "distribution > more metrics" was wrong for the fake-cashflow case; their rent model is on the critical path, ahead of my cosmetic fixes. (But I add a free P0 they didn't: kill the fake display *now*, before the model lands.)
- **Conceded to `persona`/`data-quant`:** Pocket Terminal is not a launch-making move; demoted to a scoped responsive *floor*, fast-follow.
- **Held:** the trust-spine surface fixes (real watchlist, dead-code removal, sqft labeling) are cheap, parallel, and still mine — they flank the rent model, not block it.
