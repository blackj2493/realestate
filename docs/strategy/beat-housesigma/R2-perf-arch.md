# R2 — perf-arch (Reconciliation)

Read the ballot + all R1s. I own **Open Q#3 (heat layer J — launch vs fast-follow)** and **Open Q#4 (phasing + effort estimates)**. Both resolved below with real numbers, then my ranked top-5, concessions, and one logged dissent.

---

## OPEN Q#4 — Phasing & effort estimates (my assigned call)

**Verdict: the ballot's `A → B → C / D+E / F+G+H` ordering is correct. One re-phasing: split E, and confirm A is a true blocker, not a parallel.** Estimates are S(≤2d) / M(3–5d) / L(1–2wk), engineering-days, one mid-level eng.

### Phase 0 — the critical path is A, and A is *sequential*, not parallel
- **A. Stabilize prod — `M` (3–5d), but front-loaded by a `S` (≤1d) triage.**
  - Triage (`S`, hours–1d): determine *which* tier is 502-ing. Typesense "Application failed to respond" is a cluster-process error (down/OOM/cold), not a query 4xx — so first action is the Typesense Cloud console (cluster health, RAM headroom vs the `typesenseSchema.ts:23-28` RAM-policy ceiling, restart/right-size). In parallel re-check Supabase compute health ([[supabase-compute-sizing]] NANO→522 precedent) and create the 3 missing feeder tables (data-quant's 404s — that's a `S` migration, separate concern but same outage window).
  - Hardening (`M`): synthetic uptime + freshness alerting on both backends (the nightly sync silently advances its cursor on failure — [[trreb-feed-tokens]] — so "quiet" ≠ "healthy"; alert on `records_synced=0` AND cursor-advanced-on-failed-status), plus a client-side circuit-breaker / last-known-good so a 502 degrades to stale-but-rendered, not a blank terminal.
  - **Why A is a blocker, not a parallel:** every downstream move *writes to or reads from* the two backends that are currently failing. Re-indexing for D/H into a 502-ing cluster is how you turn an outage into data loss. A must clear triage before anything touches the cluster. *(Hardening can overlap B/C; triage cannot.)*
- **B. Kill fake numbers — `S` (≤1d).** Confirmed cheap: `LedgerRow.tsx:51-57` cap/yield cells already fall back to "—"; the change is removing the `ExtrapolatedCapRate` source + the persona "Yield" column def in `personaConfig.ts`. No data dependency. Runs parallel to A's hardening.
- **C. `VOW_ENFORCE_TERMS=true` + brokerage-display audit — `S`–`M` (1–3d).** Flag flip is minutes (`requireConsumer.ts` already supports it — compliance R1 escalation #2). The brokerage-presence audit across map popup / compare cell / ledger heart (compliance R1 escalation #1, my R0 didn't catch this — it's product-ux's surfaces but it gates the public terminal) is the `M` part. Parallel to A/B.

→ **Phase 0 = A(triage) blocks; A(harden)+B+C run concurrently. ~1 week wall-clock.**

### Phase 1 — De-fake & cache (E should be split)
- **D. Rent model + light up yield fields + fix dead heart/buttons — `L` (1–2wk).** data-quant owns the rent-model half; product-ux owns the watchlist/dead-button half (different files, parallel — product-ux R1 confirmed). data-quant's R1-confirmed de-risk: building `rental_market_index` in **Supabase is zero-Typesense-load** and the **nightly delta upsert backfills yield fields organically** — so no forced 131k full re-index is required. This removes my OOM concern. Good.
- **E. Listing-page ISR/cache — SPLIT into E1 + E2:**
  - **E1. ISR + `unstable_cache(getListingDetail)` + `select` named columns not `*` — `S`–`M` (2–4d).** Config + cache wrapper (market routes already use this pattern), keyed to the 24h sync cadence. **Hard condition from compliance R1 (Ruling on my Move 2): the cache must be AUTH-PARTITIONED** — cache only the IDX body; VOW-gated fields (AVM, sold history, breakdown) computed per-request behind `requireConsumer`, never baked into shared ISR/CDN HTML. I'm building it that way.
  - **E2. Move `/PropertyRooms` ingestion to ETL — `M` (3–5d).** Pre-store rooms into `full_payload` at sync time so SSR makes **zero** external ProptX calls (`getListingDetail.ts:154-176` already prefers stored rooms — just guarantee they're always stored). This is the part that removes the third-party hop from the hot path; it's a worker change, parallel to E1.
  - **Why split:** E1 alone captures ~80% of the scale + CWV win (no detoast-`*`, cached, ISR) and is the prerequisite product-ux + growth need *now*. E2 is the durability hardening; it can land a sprint later without blocking the funnel-flip.

### Phase 2 — F (funnel-flip) + G (Flipper wedge) + H (underwrite-the-map)
Ordering correct. **One sequencing condition I'm holding (co-signed with product-ux R1):** F must land *after* B (or the anon teaser shows the fake `ExtrapolatedCapRate` to every new visitor — worst first impression) **and after E1** (or the funnel pours crawlers/viral traffic onto the uncached `force-dynamic` listing page = self-DoS + tanked CWV that kills growth's own SEO). H depends on D. This isn't a re-phasing — it's already the ballot order — but the *gating* is load-bearing, not advisory.

**Net critical path:** `A(triage)` → [`A(harden)` ∥ `B` ∥ `C`] → [`D` ∥ `E1`→`E2`] → [`F`(gated on B+E1) ∥ `G`] → `H`(gated on D). Nothing is mis-phased; my only change is splitting E so E1 unblocks Phase 2 sooner.

---

## OPEN Q#3 — Heat layer (J): LAUNCH or fast-follow? **Fast-follow (early Phase 3). I lose the "launch" framing to `product-ux` — and I think they're right.**

I argued the 100-pin cap is a real product ceiling and J is how we beat HouseSigma on their own map surface. I still believe that. **But product-ux's R1 thesis — "distribute existing edge, don't add surface, while the trust spine is broken" — wins on sequencing here, and I concede it.** Reasoning:

1. **J is not on anyone's critical path, and it's net-new surface.** The launch-makers (per 4-agent convergence) are G (Flipper wedge, real data today) and H (underwrite-the-map). J makes a *good* map *better*; it doesn't fix a broken or fake thing. By the council's own quality bar + product-ux's "fix the front door before polishing the basement," J waits.
2. **J's compliance-clean public tier is genuinely cheap once A is done** — compliance R1 Ruling 1 pinned it: public density `{count}` + mean-of-RAW-field per cell, k≥5 fixed server-side grid, reusing the *existing* `per_page:0` count machinery (`client.ts:49-66`) and the *existing* deck.gl `HexagonLayer` (`AlphaMap.tsx:394-425`). Estimate **`M` (3–5d)** for the public tier; the gated derived-analytic/sold tier is a further `M`. No new dependency. So it's a *cheap fast-follow*, not a big bet — which is exactly why it shouldn't jump ahead of the spine fixes that are also cheap AND on the critical path (B, E1).
3. **It compounds better later anyway.** J's value multiplies once H ships (a yield heat layer is far more compelling when the per-pin yield is *real*, post-rent-model). Shipping J before D/H would heat-map the same fake/empty metric we're killing in B. **So J should land after D, as an early-Phase-3 amplifier of the now-real data — not at launch over stale numbers.**

**My resolution with product-ux:** J = **Phase 3, first item**, public density+raw-mean tier only at first (the anti-truncation win, which dovetails with growth's "open lobby" anon teaser), gated analytic/sold tier behind it. Not a launch blocker. We agree.

---

## My ranked top-5 (Impact 1-5 × Effort × Compliance-risk)

| # | Move | Impact | Effort | Compliance | Why it's here |
|---|---|---|---|---|---|
| **1** | **A. Stabilize prod + health alerting** | **5** | M (triage S) | Safe | **HELD: the "instant" promise is currently FALSE in prod (sustained Typesense 502). A sub-50ms design that 502s = 0ms of value.** Blocks 100% of everything else. Non-negotiable #1. |
| **2** | **E1. Listing-page ISR/cache (auth-partitioned)** | **5** | S–M | Safe (cache IDX only) | Shared dependency under growth's SEO funnel, product-ux's trust spine, competitive's SEO surface. Lowest effort per unit of unblock on the board. Cheaper than D or M; gates F. |
| **3** | **D. Rent model → real yield/cashflow fields** | **5** | L | Gated (VOW-leased blend) | The data moat + the beachhead's spine. Converts empty `gross_yield_est`/`cashflow` into the product's reason to exist. Makes H possible. (Highest impact but L-effort → ranks just under the two cheap-but-blocking infra moves.) |
| **4** | **B. Kill fake numbers** + **C. enforce-terms/brokerage audit** | **4** | S each | Safe / precondition | Cheapest trust + compliance wins on the board; B removes the "this product is lying" landmine before any anon sees it; C is a precondition for every gated surface. Pure ROI. |
| **5** | **H. "Underwrite the whole map"** | **5** | M (post-D) | Gated | The 4-way-convergent magic moment + Flipper-wedge G's companion. Ranked 5th only because it's *downstream* of A+D; once they land, this is the launch headline. |

(J, my own R0 Move 1, deliberately *not* in my top-5 — see Q#3 concession. It's a Phase-3 amplifier, ranked ~6.)

---

## Cut / add / re-score
- **No cuts.** Builder-persona cut + L (SEO) on-hold already have consensus; I concur — L correctly waits on an active-IDX aggregate (which J's public tier actually *builds*, so J→L is a natural pipeline later).
- **Re-score E:** the ballot lists E as one item; I'm scoring **E1 as top-3** (the high-leverage 80%) and **E2 as a Phase-1 fast-follow** (durability). Don't let E2's worker-change effort delay E1's config-change win.
- **Add (small, to A):** creating data-quant's 3 missing feeder tables belongs *in the Phase-0 outage window* — it's the same "stop the bleeding" sprint and D can't start without them.

---

## Concessions log
- **Conceded to `product-ux` (Q#3):** J (heat layer) is a fast-follow, not a launch move. Distribute existing real edge before adding new map surface; J amplifies H's *real* data rather than heat-mapping the fake metric we're killing.
- **Conceded to `data-quant` (R1):** the rent model needs no forced full re-index (Supabase build = zero Typesense load; nightly upsert backfills organically). My OOM concern is real only if someone forces a one-shot 131k re-index — so the standing rule is "don't, unless the cluster is confirmed right-sized."
- **Conceded the framing to `data-quant`/`persona` (carried from R1):** perf is necessary, not sufficient — the metric layer is *empty*, not just capped.
- **Accepted as a hard condition from `compliance` (R1):** my ISR cache (E1) must be auth-partitioned — IDX body cached, VOW rail computed per-request behind `requireConsumer`, never in shared/CDN HTML. Building it that way.

## Dissent (logged, minor — does not block consensus)
I **hold one point against the implied consensus** that the 100-pin cap is "fine because aggregates cover it": it is fine *for now*, but the cap-as-product-ceiling is real and will resurface. When J's public tier ships, we should treat the **density+raw-mean heat layer as the permanent answer to "show me more than 100,"** and explicitly *forbid* any future "load more / infinite scroll" workaround that would breach §6.3(b) (compliance R1 Ruling 5 condition #1 agrees). I want that on the record so a future eng doesn't "fix" the cap the illegal way. Otherwise I fully endorse the converged plan.
