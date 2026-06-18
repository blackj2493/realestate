# R2 — product-ux (Reconciliation)

Read `R2-BALLOT.md` + all R1s + compliance's five rulings. I **endorse the ballot's phasing** with one revision (M is a launch-gate *for F*, not free-floating polish) and resolve the three questions the lead assigned me. Concessions from R1 stand: data-quant's rent model is critical-path ahead of my surface fixes; Pocket Terminal demoted to a responsive floor.

---

## Confirmations the lead asked for

### B (kill fake numbers) — CONFIRMED: free, ~1-file, no data dependency.
The display already degrades gracefully — `LedgerRow.tsx:51-57` (`capRate`/`yield` cells) and `columnSort.ts:56-59` both fall back to `—` when `ExtrapolatedCapRate`/`cap_rate_est`/`gross_yield_est` are absent. So "kill fake" is **not new UI** — it's removing `ExtrapolatedCapRate` as the *source* for the cap/yield cells + the cashflow persona's `sortBy`/`mapColor` (`personaConfig.ts:272,280`). With growth's persona-scoping insight, the cleanest cut is even narrower: **the poison is confined to the `cashflow` persona** (sort + columns + map color all keyed on the fabricated number, `personaConfig.ts:272-281`); the `flippers` persona is 100% real fields (`:303-312`). So B in practice = (i) default first-run to `flippers` (store `commandCenterStore.ts:226` is currently `smart`), and (ii) gate/relabel the cashflow view's cap-yield until D lands. **Effort S, Impact 4 (kills the credibility landmine), Safe.**

### D (trust-spine ships WITH the rent model) — CONFIRMED, and the framing is right.
"Fake heart and fake cap rate are the same bug class" is exactly my R1 thesis. The dead watchlist heart (`LedgerRow.tsx:107,159-167` — local `useState`, never calls `useWatchlistStore`) and the dead drawer CTAs (`ListingTerminal.tsx:527-532` — no onClick, while the *working* `WatchButton`/`useWatchlistStore` already power `ListingActions.tsx:48-69`) are surface-leaks in the **same trust category** as a fabricated number. They touch **different files** than the rent-model ETL work, so they ship in parallel within Phase 1 — D is one phase, two workstreams (data-quant owns the rent table; I own the surface wiring + dead-code removal of `highlightNLPFlags` `ListingTerminal.tsx:63-87` + the bucket-sqft "est." label `:336`). **Effort S–M, Impact 4, Safe.**

---

## Open Q#3 — Heat layer (J): **FAST-FOLLOW, not launch.** (resolving with perf-arch)

perf-arch and I converge here, and I defer to their ranking. Their R1 §3 explicitly ranks the shared-infra tier: **Task#0 stabilize → ISR/cache → rent model → *then* feature/distribution (heat layer, mobile, referral).** The heat layer is in that last tier *by perf-arch's own ordering*, and I agree. Reasons it's fast-follow, not launch:

1. **It's gated on a compliance ruling that only just landed.** Compliance Ruling 1 splits it: active-IDX heat = SAFE/public; **sold/VOW heat = GATED + min-N≥5 suppression.** The *compelling* version for our Flipper beachhead (sold-DOM / sold-compression intensity) is the gated one, which needs `requireConsumer` wiring + the min-N guardrail built — that's not Phase-2 cheap.
2. **The active-only version (density/active-DOM) is real but a weaker wedge** than the launch features (G Flipper badges, H underwrite-the-map) — it improves map *legibility*, it isn't the magic moment.
3. **perf-arch R1 §0: the cluster is currently 502-ing.** A new aggregate query layer on a flapping cluster is the wrong thing to add before Task#0 stabilizes it.

**But it stays on the roadmap (not cut)** because perf-arch is right that a map capped at 100 pins is structurally thinner than HouseSigma's — the heat layer is how we beat them *on their own surface* without breaking the 100-cap. **My call: J = Phase 3, active-IDX density version first (public, cheap, reuses the `per_page:0` machinery in `client.ts:49-66`), sold-intensity version gated as a fast-follow within Phase 3.** Score: **Impact 3, Effort M, Safe(active)/Gated(sold)+min-N≥5.**

---

## Open Q#1 — Minimum the anon active card must SHOW to convert without leaking gated analytics

Compliance Ruling 5 condition #4 is the precise boundary, and it's subtler than the room thought: **active *data* is public, but active-data *analytics* still hit IDX §6.2(f) (no carve-out).** So:

**The anon active card CAN show (all per-listing, display-computation or raw — no dataset derivative):**
- Raw **list price**, **address**, beds/baths/parking, photo, property type. *(IDX §3.2 display.)*
- **Brokerage** (`ListOfficeName`) — mandatory, sibling weight (§6.3(c)). Already rendered via shared `ListingCardBody.tsx:109-114`.
- **"Listed N days ago" / freshness** (`ListingCardBody.tsx:21-27`) — the active listing's own DOM, not stitched True DOM.
- **Price-drop FACT on the current active listing** — "−$25k since listed," computed from the listing's *own* `OriginalListPrice` vs `ListPrice` (`soldVsAsk` pattern, `ListingCardBody.tsx:73`). This is a display computation on one listing's own fields, not a dataset analytic. **This is the conversion hook** — a visible distress fact HouseSigma buries.
- **Carrying cost** (`carryFor`, `columnSort.ts:17-24`) — deterministic display computation off list price + tax + fee. Compliance Ruling 5 #4 explicitly blesses this ("a per-listing carrying-cost off list price + tax is a display computation, not a dataset derivative").

**The anon card must NOT show (gated or forbidden):**
- **True DOM (stitched across relists)** — VOW-sold-derived → GATED. The anon card shows *active* DOM only; stitched True DOM unlocks behind the rope. (This is a real product distinction to design, not a bug.)
- **AVM / estimate / Value-Add upside / Deal Score's AVM components** — VOW-derived → GATED.
- **Any comparative/aggregate analytic** ("cheaper than 80% of the neighbourhood," "yield vs area") — leans on IDX §6.2(f) which has *no* carve-out → must be an aggregate (Ruling 1) or gated. **This is the trap: a "this is a good deal vs comps" badge on an anon card is non-compliant** unless it's purely the listing's own price-drop fact.

**Net answer:** the minimum viable anon card = **price + address + specs + brokerage + freshness + active price-drop fact + carrying cost**, with a **locked teaser** ("True DOM, estimate & comps — sign in") for everything VOW-derived. That converts (it shows a real distress signal + real carry, which Realtor.ca doesn't and HouseSigma gates harder) while leaking nothing. The price-drop fact is the single highest-converting compliant element — lead the anon card with it for the Flipper beachhead.

---

## Brokerage-display breach vector (compliance escalation #1) — partial all-clear from me

Compliance flagged map popups / ledger rows / compare cells as unaudited (§6.3(c)). I verified two of three:
- **Map popup ✓** — `ListingMapPopup.tsx:42` renders `ListingCardBody`, which shows `ListOfficeName` at sibling weight (`ListingCardBody.tsx:109-114`).
- **Ledger row ✓** — `LedgerRow` renders the same `ListingCardBody` (`:170-172`); brokerage present.
- **Compare cells — UNVERIFIED** (I haven't read `/properties/compare`). Flagging to compliance/perf-arch as the one remaining surface to audit before the funnel-flip (F) ships.

The "ledger heart" compliance worried about is *inside* a `LedgerRow` that already carries brokerage — so the heart being half-wired (a trust bug, my D) is separate from the brokerage-display question (which is satisfied on that row).

---

## My ranked top 5 (of A–M)

Scored Impact(1-5) × Effort(S/M/L) × Compliance(Safe/Gated/Forbidden). I rank by *unblocking power × trust*, holding "distribute existing edge through non-leaky surfaces."

| # | Move | Impact | Effort | Compliance | Why this rank |
|---|---|---|---|---|---|
| **1** | **A — Stabilize prod (Typesense 502 / health alerting)** | 5 | M | Safe | Conceded to perf-arch: a sub-50ms design that 502s is 0ms of value. Nothing I own (drawer, ledger, funnel) renders against a dead backend. Not my mandate to build, but it's #1 on any honest list. |
| **2** | **B — Kill fake numbers + default to Flipper persona** | 4 | S | Safe | Cheapest trust win on the board; free; removes the credibility landmine *before* F exposes the terminal to anon traffic. My P0, sharpened by growth. |
| **3** | **E — Listing-page ISR/cache + rooms-to-ETL** | 5 | M | Safe (auth-partition cache per compliance R1) | The shared dependency under my drawer's "Open Full Report," growth's SEO, competitive's Realtor.ca-parity claim. Higher fan-out + lower effort than the rent model. Co-signed with perf-arch. |
| **4** | **D — De-fake (rent model + trust-spine wiring)** | 5 | M–L | Safe (rent model VOW-blend → gated cap numbers per compliance R1) | The real cashflow spine + my dead-heart/dead-button/dead-code fixes ship together. The data moat *and* the trust spine. Critical-path for H. |
| **5** | **F — Open the lobby, gate the vault (funnel-flip)** | 5 | M | Safe (compliance Ruling 5, 4 conditions) | The TTV fix (my R0 #6). But it ships **only behind B + E + M** (see dissent/condition below) so we don't pour traffic into fake numbers, an uncached page, or a desktop-only wall. |

**Just-missed:** G (Flipper badges — high impact, but it's the *content* that rides on F+B; effectively bundled). H (underwrite-the-map — the north-star magic, but gated on D's rent model, so it's Phase 2-end, not top-5-by-readiness). M (mobile — see below, it's a *gate on F*, ranked there).

---

## The one revision I'm pressing: M (mobile floor) is a LAUNCH-GATE ON F, not generic fast-follow

The ballot demotes M to "fast-follow, not launch-blocker" (line 33). **I partially dissent — narrowly.** In *absolute* terms M is fast-follow (I conceded Pocket Terminal isn't launch-making). But **M is a hard precondition for F specifically**: growth's funnel-flip + SEO sends a large share of newly-acquired traffic, and forum/mobile share skews mobile, into a terminal with **zero responsive primitives** (grep of `CommandCenter/` = 0 `md:`/`matchMedia`/touch; hard side-by-side `page.tsx:272`; mouse-only resize `:119-137`). Flipping F before the minimal `lg:` Map/List toggle exists *burns the acquisition F creates.* 

**Resolution (agreed with growth):** M's *scope* shrinks to the minimal toggle (one-file CSS breakpoint + pointer events on resize), and it's ranked **as a condition of F**, not as its own feature. The full bottom-sheet Pocket Terminal stays Phase 3+. So: **F's dependency chain = B + E + M(minimal).** Don't ship F until all three are in. This isn't "mobile is launch-critical on its own merits" — it's "don't open a door you've made unwalkable for the visitors you invited."

---

## Dissents on record
1. **M-as-F-gate** (above): I do not endorse shipping F (funnel-flip) before the minimal responsive toggle. If the lead sequences F ahead of M, log my dissent: it converts worse and wastes growth's spend.
2. **None on Flipper-first or cutting Builder** — I fully endorse both (Builder is hollow per persona's `BuilderAnalyticsEngine.js` evidence; Flipper-first uses the only fully-real field set today).

## Concessions log (carried from R1, reaffirmed)
- Conceded to data-quant: rent model (D) outranks my standalone surface fixes; they ship together, data first.
- Conceded to persona/data-quant: Pocket Terminal is not a launch move; demoted to the minimal responsive floor.
- Conceded to perf-arch: A (stabilize) is #0; E (ISR) outranks both the rent model and mobile in the infra tier.
- Held: the trust-spine surface fixes are real, cheap, parallel, and mine; the anon card's price-drop fact is the compliant conversion hook.
