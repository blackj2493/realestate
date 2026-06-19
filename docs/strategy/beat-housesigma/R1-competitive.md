# R1 — Competitive Analyst (cross-examination)

**Author:** `competitive` · Round 1 · Read all seven R0 files.
**One-line:** Compliance's IDX≠VOW split dissolves my R0 framing of the rope fight, and data-quant's "fake yield" finding forces me to re-rank my own moves. I concede both — and my competitive case gets *sharper*, not weaker, because the two surviving wedges (True DOM, condition-aware AVM) are exactly the ones HouseSigma structurally cannot match.

---

## 1. The rope fight, reframed (vs `growth`, settled by `compliance`)

In R0 I said: don't lower the velvet rope, it's the generic-middle trap HouseSigma wins. **`compliance` proved that framing was imprecise and I'm revising it.** The decisive facts:

- **Active IDX listings are licensed public/indexable** — that IS the registered Subscriber Website use (`compliance` R0 §2 SAFE; IDX §3.2 Purpose; `sitemap.ts` already emits 45k pages, `robots.ts` already allows `/properties`).
- **Sold + AVM + any VOW-derived metric is gate-mandatory** — not a UX preference but the licence itself (VOW §6.2(f) "on their VOW(s)" = password-protected + bona-fide consumer).

So `growth`'s "flip the funnel — open terminal, locked vault" (R0 Move 1) is **not the generic-middle trap, and I withdraw that objection.** Opening the *active* terminal to anon users is legally permitted, cheap, and the velvet rope still stands exactly where compliance requires it (the data line). **I concede the front-door rope to `growth`.**

**But here is the refinement that keeps my R0 spine intact, and where I still push `growth`:** the question is not "is mass-reach a trap" — it's **"mass-reach of WHAT, and does it differentiate us?"** Two hard points:

1. **An open active-listing terminal is table stakes, not a wedge.** Realtor.ca + HouseSigma both already show active listings to everyone. If our anon experience is "another active-listing browser," we've spent our differentiation. The open terminal only beats them if the **anon-visible active metrics are ones they don't show** — and per `compliance` R0 §1 limit #2, **anything computed purely from the IDX/active feed has NO analytics carve-out (IDX §6.2(f) forbids it, even behind a login).** This guts a chunk of `growth`'s Move 1: "True DOM on active, price-compression vs list, cap-rate-on-list" for anon users may be **IDX-derived = forbidden**, not just empty. *True DOM specifically is safe only because it stitches in VOW sold/closed chains (`TemporalDistressEngine` reads sold history) — which makes it VOW-derived = gate-only.* So the genuinely differentiating anon metric set is **much thinner than `growth` assumes.** → direct challenge to `growth` below.

2. **What HouseSigma actually does at its OWN gate** (grounded, R0 sources): HouseSigma shows active listings + the *map* publicly, but **sold prices, sold history, and the "HouseSigma value" estimate require a free account** — they gate the exact same data we must gate, then use it as a registration wall feeding their 1.5% brokerage. So the strategic contest at the gate is **not whether to gate (both must) — it's what the locked teaser promises.** This is where `compliance`'s Move 1 ("aggregate teaser: 7 sold firm in 30d, median True-DOM 41d, 3 under ask") is genuinely superior to HouseSigma's bland "sign up to see sold price," and I'm endorsing it (see §5).

**Net:** rope at the data line = mandatory and a feature; rope at the front door = drop it (concede to growth). My surviving worry, now narrower: an open terminal that shows only *commodity* active data is a wasted differentiation. The anon teaser must be **aggregate VOW-shaped** (compliance's lane), not "richer active metrics" (growth's lane, partly forbidden).

---

## 2. Does persona's "cut Builder, Cashflow beachhead" sharpen or blunt my three moves?

`persona`'s teardown of Builder (`BuilderAnalyticsEngine.js`: `multiplexByRight=false` hardcoded, price-per-buildable-sqft mislabeled) is **devastating and correct — I fully endorse cutting Builder from launch.** A developer spots a fake zoning tool in 60 seconds; shipping it poisons credibility with the analytical audience we court (CLAUDE.md §10). My R0 never leaned on Builder, so this costs me nothing and I back it 100%.

But on the **beachhead choice, persona and I diverge, and it's a real disagreement worth pressure-testing:**

- **persona says: Cashflow Investor is the beachhead, Flipper is fast-follow.** Rationale: the Underwriting Sandbox is the most-finished magic moment.
- **I say: the Sandbox is finished but runs on FAKE rent (data-quant proved it). The Flipper wedge (True DOM) runs on REAL, populated data TODAY.**

This is the crux. Mapping to my R0 moves:
- **My Move 1 (True DOM + Capital Burn badge) → Flipper.** Verified populated: `TrueDom`, `TotalPriceDrop`, `IsStale`, `CapitalBurnRate` (persona R0 §2; data-quant R0 confirms `property_sale_history` = 214k rows, `extrapolated_cap_rate` ~100% populated). **This wedge works in production right now.**
- **My Move 3 (self-serve underwriting terminal) → Cashflow Investor.** data-quant proved the yield/cap/cashflow fields are 404-empty and `ExtrapolatedCapRate` is `f(ListPrice)` cosplay. **This wedge is vapor until the rent model lands.**

So persona's beachhead pick **blunts my strongest move (Flipper/True DOM is real) and elevates my weakest (Cashflow is fake today).** My refinement: **the beachhead should be sequenced by data-readiness, not by which page looks most finished.** Lead with the **Flipper/True-DOM wedge** (real now), and make Cashflow the beachhead *the moment* data-quant's Move 1 (real rent model) ships — which persona's own Move 1 also depends on. We're not actually far apart: persona's Cashflow Move 1 ("underwrite the whole map") and data-quant's Move 1 (build `rental_market_index`) are **the same prerequisite.** I'll propose we treat "real rent model" as the gating milestone and run **Flipper-first, Cashflow-on-rent-landing.**

---

## 3. Does my competitive case survive on AVM + True DOM alone until rent lands? (vs `data-quant`)

`data-quant` is right and I concede the point: **my R0 Move 3 "self-serve underwriting terminal as anti-funnel wedge" currently runs on fake yield.** A cap rate that's `f(ListPrice)` — same number for a $400k condo and a $400k bungalow (data-quant R0 §7) — is *worse* than showing nothing to the exact analytical user who checks the math. Leading acquisition with it would burn us. **I withdraw "underwriting terminal" as a NEAR-TERM leapfrog move and re-file it as a fast-follow gated on data-quant Move 1.**

**Does the competitive case survive without it? Yes — and arguably it's cleaner.** The two surviving wedges are the two HouseSigma *structurally* cannot match, and both run on real data:

1. **True DOM across relist chains (Flipper).** Real now. HouseSigma shows current-listing DOM and *surfaces* relisting as "a new MLS number" but never collapses the chain into one honest number (R0 sources: its own ecosystem calls raw DOM "nearly useless / too easily gamed"). This is the institutional shadow-data in our mission, populated today.
2. **Condition-aware AVM + the glass-box "Why this estimate" (Homebuyer/Flipper).** HouseSigma's own marketing concedes its estimate **"cannot see the difference between a renovated house and a house in original condition"** (R0 source). data-quant R0 §B confirms our AVM is real (~11.4% MAE, R²≥0.5 on 49% of cohorts, honest anchor fallback) AND that we compute `AVMAdjustmentBreakdown` per-feature. **A glass-box, condition-aware estimate is a wedge that runs on data we have and attacks a weakness they've admitted in writing.** This is data-quant's Move 2 and my R0 Move 2 — we converge.

So: **True DOM + condition-aware glass-box AVM carry the competitive narrative alone until rent lands.** The underwriting terminal becomes the *third* leapfrog, not the first. My case survives — it actually tightens to "two unmatchable wedges on real data" instead of "three, one of which is vapor."

**One thing I'll hold data-quant to:** retire or relabel `ExtrapolatedCapRate` (R0 Move 1 tail). If we keep showing a fake cap rate while marketing "institutional-grade data," a single power user's screenshot torpedoes the whole positioning. The credibility landmine is a *competitive* risk, not just a data hygiene one.

---

## 4. Where I challenge / strengthen specific peers

- **`growth` (Move 1) — CHALLENGE:** the open-terminal anon metric set is thinner than you think. "True DOM on active / cap-rate-on-list / price-compression" for anon may be **IDX-derived = forbidden** (compliance R0 §1 #2), not merely empty. Your funnel-flip is right; your bait is half-illegal. Re-spec the anon teaser to **aggregate-VOW-shaped** (compliance Move 1) + active listings + the *AVM/True-DOM teaser shapes behind the gate*. (Direct message sent.)
- **`growth` (Move 2 Deal Card) — STRENGTHEN + GUARD:** the branded "Deal Card" pasted into BiggerPockets/REIN is exactly how our personas already behave (they screenshot deals). It's our best viral unit *and* it's competitively unique (HouseSigma shares a bare listing link). BUT compliance R0 ⛔ + §5: a public card with AVM/sold-derived numbers breaks VOW §6.2(f). So the card must run on **active-listing facts + brokerage attribution only** when shared to a logged-out recipient. A True-DOM number on a public card is also gate-only (it's VOW-derived). The viral card is real but its *contents* are narrower than drawn.
- **`persona` (beachhead) — CHALLENGE (productive):** sequence by data-readiness. Flipper/True-DOM is real today; Cashflow is your strongest persona but its magic is fake until rent lands. Run Flipper-first, flip to Cashflow-beachhead the day `rental_market_index` ships. We agree on the destination, disagree on the order.
- **`product-ux` — STRENGTHEN, and concede his challenge to me:** product-ux's R1 preview says "the win is distribution of existing edge, not more edge" and calls out that I'll push *new* engines. **He's right and I'm adjusting:** none of my surviving moves is a new engine — they're all *exposing* True DOM and the AVM breakdown that already exist. His mobile-terminal + Sandbox-as-front-door + dead-button fixes are the delivery vehicle for my wedges. A True-DOM badge on a dead-button, desktop-only, save-doesn't-persist surface beats nobody. **I endorse his trust-spine fixes as prerequisites to my moves landing.** The one place I'd push back: a live underwriting Sandbox on mobile (his Move 1+2) is downstream of data-quant's rent model too — same gating milestone.
- **`compliance` (Move 1 aggregate teaser) — ENDORSE:** this is the single best competitive idea in the council. It out-teases HouseSigma's gate with *insight* ("median True-DOM 41d, 3 sold under ask on this block") instead of a bland paywall, and it's SAFE (aggregate, server-side). It's the answer to "what does the locked vault promise" — and it's strictly better than what HouseSigma puts behind its registration wall.
- **`perf-arch` — FLAG:** data-quant hit Typesense 502s all session; perf-arch must confirm the terminal's only backend isn't intermittently down before any "instant" claim is competitively credible. "Faster than HouseSigma" dies if we 502.

---

## 5. My revised competitive shortlist (heading into R2)

1. **True DOM + Capital Burn as the signature gated badge** — real data, unmatchable wedge, Flipper. (R0 Move 1, unchanged, now my #1.)
2. **Condition-aware glass-box AVM ("Why this estimate" + the renovated-vs-gut answer HouseSigma admits it can't give)** — real data, gate-only per compliance, Homebuyer/Flipper. (R0 Move 2 ∩ data-quant Move 2.)
3. **Compliance's aggregate VOW-teaser as the gate's promise** — turns the mandatory rope into a sharper hook than HouseSigma's. (Endorsing compliance Move 1.)
4. **Self-serve underwriting terminal (anti-funnel wedge)** — DEMOTED to fast-follow, gated on data-quant Move 1 (real rent model). (R0 Move 3, re-sequenced.)
5. **CUT Builder** (endorse persona) and **retire/relabel `ExtrapolatedCapRate`** (endorse data-quant) — both credibility protections.

---

### Concessions logged
- Conceded the **front-door rope** to `growth` (active terminal can/should be open; compliance confirms it's licensed).
- Conceded to `data-quant` that the **underwriting terminal runs on fake yield today** — demoted from leapfrog to fast-follow.
- Conceded to `product-ux` that **distribution of existing edge > new engines** — my moves are all exposure, not new metrics.
- Endorsed `persona`'s **cut-Builder**; disagree only on beachhead *ordering* (Flipper-first by data-readiness).
