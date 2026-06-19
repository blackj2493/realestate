# R2 — Competitive Analyst (reconciliation)

**Author:** `competitive` · Round 2 · Read `R2-BALLOT.md` + all R1 files.
**Phasing:** I **endorse** the lead's A→B→C / D+E / F+G+H / I-J-K-L-M phasing as written. One ordering nuance below (G must visibly lead Phase 2's launch narrative, not just sit beside F).

---

## 1. Open Q#1 — is the anon hook still differentiated, or is it the generic middle? (I own this)

**The question, sharpened by compliance's Ruling 5 condition #4:** a logged-out user can see *active data* freely, and *single-listing display computations on that listing's own fields* (carrying cost off list price + tax; a price-drop **fact** = OriginalListPrice − current, which compliance treats as field-display, pending its final ruling). But **active-dataset ANALYTICS** ("cheaper than 80% of the neighbourhood") still hit IDX §6.2(f) which has **no carve-out** → those must be aggregate/gated. And every genuinely *institutional* per-listing metric we own — True DOM, AVM, Value-Add, sold comps — is **VOW-derived = gated**.

So the honest anon surface is: **raw active listings + raw feed DOM + a per-listing price-drop fact + brokerage.** Asked plainly: **is that differentiated vs HouseSigma's free tier?**

**Answer: No — not on its own. That layer IS the generic middle, and I'll say so bluntly.** HouseSigma's logged-out tier already shows active listings + the map + raw DOM. If our anon experience stops there, we've earned a click and shown an investor Realtor.ca's data with a darker theme. The funnel-flip (F) is *necessary* (growth won that — the moat is worthless if nobody touches it pre-application) but it is **not sufficient** to differentiate.

**The one anon-visible thing that makes a high-intent investor sign up** is the **aggregate-VOW distress/velocity teaser** (compliance Ruling 1 = SAFE public for *active* aggregates; the sold/VOW aggregate variant is gated, so the public teaser is the active-velocity + a count-only sold shape with min-N≥5). Concretely, as the investor pans the map, each block shows:

> **"23 actives · median posted DOM 31d · 6 price-cut this week · [sign in: 7 sold firm in 30d, median True-DOM 41d, 3 under ask]"**

That sentence is the wedge, and here's why it specifically beats HouseSigma rather than matching it:
- **HouseSigma's gate teases *nothing*** — it's a bland "register to see the sold price." Ours teases **insight shapes**: velocity, price-cut intensity, and (behind one tap) relist-corrected True-DOM and under-ask rate. We make the investor think *"these people see the market's temperature, not just its listings"* before they spend an email.
- It's a **count/distribution, not a Listing** → outside the §6.3(b) 100-cap and (active variant) public-safe per compliance Ruling 1. The regulated row-level numbers stay home.
- It is **literally not buildable on HouseSigma's incentive structure**: surfacing block-level distress velocity to a logged-out investor accelerates self-serve decisions and *reduces* the agent hand-off their 1.5% brokerage depends on. We have no brokerage to protect, so we can lead with it.

**The gated payoff the teaser points to — this is where G and I land:**
- The aggregate teaser's headline number ("median True-DOM 41d") resolves, behind the application, into **G — the per-listing True DOM badge + relist chain + Capital Burn**: *"posted 12 days; actually 96 across 3 relistings, −$85k since first ask."* That is the Flipper's exact job-to-be-done and the cancel-and-relist tactic HouseSigma only half-exposes.
- The "what's it worth / is this priced for a reno or a gut job" curiosity resolves into **I — the glass-box condition-aware AVM** + "Why this estimate" breakdown + sold timeline. HouseSigma admits *in writing* its estimate "can't tell a renovated home from a gut job"; we answer that question, gated, with a per-feature glass box theirs is a black box.

**Net for Open Q#1:** the anon hook is differentiated **only if it's the aggregate-VOW-shaped teaser, not the raw-active floor.** The raw floor (Layer 1) earns the click; the aggregate teaser (Layer 2) earns the signup; G + I (Layer 3, gated) are the payoff that earns the daily habit. This is exactly the 3-layer spec growth and I co-authored (cross-attributed in both our R2s), and it's now fully consistent with compliance's Ruling 1 + Ruling 5.

### The unified ANON/GATE teaser spec (co-authored with `growth`, vetted vs compliance Rulings 1 & 5)
- **LAYER 1 — PUBLIC active-IDX passthrough** (licensed Subscriber Website display, NOT a derivative): address, ListPrice, beds/baths/sqft-bucket, **raw feed-native DOM** (not stitched), brokerage (§6.3(c)). *Competitive axis: parity / table-stakes. Must NOT be what we lead with.*
- **LAYER 2 — PUBLIC aggregate teaser** (compliance Ruling 1: active aggregates SAFE-public; sold/VOW aggregates gated → public teaser = active velocity + min-N≥5 count-only sold shape, server-side, never rows): block-level "N actives · median posted DOM · M price-cut this week · [locked: sold velocity / True-DOM / under-ask]." *Competitive axis: **THE wedge** — out-teases HouseSigma's blank gate with insight shapes.*
- **LAYER 3 — GATED row-level** (`requireConsumer`, terms-enforced): per-listing True DOM + relist chain (**G**), AVM + "Why this estimate" + sold timeline (**I**), Value-Add, sold comps. *Competitive axis: the unmatchable moat; the application proves bona-fide interest (VOW §3.2) AND is the unlock.*
- **OPEN sub-question already routed to compliance:** single-listing OriginalListPrice − ListPrice — public field-display (Layer 1) or does the arithmetic trip IDX §6.2(f) (→ Layer 3)? Compliance R1 leans "single-listing display computation = OK public" (Ruling 5 #4) but hasn't ruled the subtraction specifically. If gated, the per-listing price-drop *fact* moves to Layer 3 and Layer 2's aggregate price-cut count carries it publicly instead.
- **Deal Card (K):** public contents = Layer 1 + brokerage ONLY (compliance Ruling 3: AVM/True-DOM/sold numbers FORBIDDEN to export off-VOW). Aggregate teaser + "see the full breakdown inside" CTA carries the loop.

---

## 2. My ranked top-5 of A–M (Impact × Effort × Compliance-risk)

Scoring: Impact 1–5 · Effort S/M/L · Compliance Safe/Gated/Forbidden.

| Rank | Move | Impact | Effort | Compliance | Why it's here (competitive lens) |
|---|---|---|---|---|---|
| **1** | **A. Stabilize prod (Typesense 502)** | 5 | S | Safe | Not a feature — the precondition. data-quant + perf-arch confirm the terminal's only backend is down *now*. "Faster than HouseSigma" is a lie if we 502. Nothing on this ballot is real until A ships. |
| **2** | **G. Flipper launch wedge — True DOM + price-drop + Capital Burn** | 5 | S–M | Gated | **My #1 leapfrog.** Runs on the real 214k sold base TODAY (data-quant + persona confirm populated). The single wedge HouseSigma structurally can't match and we can ship immediately. This is what leads the launch narrative. |
| **3** | **F. Open the lobby, gate the vault (+ aggregate teaser)** | 5 | M | Safe | The funnel that lets a cold investor *feel* G/I before applying. Growth won this; I conceded. But its differentiation lives entirely in the Layer-2 aggregate teaser (Open Q#1) — F + the teaser are one move, not two. |
| **4** | **I. Glass-box condition-aware AVM (gated full / teaser public)** | 5 | M | Gated | My #2 leapfrog. Attacks HouseSigma's written-admission blind spot with a per-feature glass box vs their black box. Real AVM data today (~11.4% MAE). Gated per compliance Ruling 4; public bait is a no-number capability claim. |
| **5** | **D. De-fake (real rent model + wire dead heart/buttons)** | 5 | L | Safe/Gated* | The unlock for the *Cashflow* destination and the honesty floor. Highest impact long-term but **L effort** + it's the gate for H (underwrite-the-map). It ranks 5th only because A/G/F/I are shippable sooner; D is the bridge from Flipper-launch to Cashflow-obsession. *(public yield SEO = gated to IDX-rent-only per compliance R1 ruling to data-quant.)* |

**Just-below-the-line (rank 6–8, endorsed but not my top-5):** **B** (kill fake `ExtrapolatedCapRate` — see §3; it's effectively part of D's honesty mandate and a Phase-0 1-file win), **C** (`VOW_ENFORCE_TERMS=true` + brokerage audit — compliance precondition for any gated surface), **E** (listing ISR/cache — perf foundation for F's traffic). I rank these high in *necessity* but they're enablers, not competitive wedges, so they sit just under my five.

---

## 3. Cut / add / re-score

- **HOLD on L (Investor-Lens SEO)** — confirm the ballot's "ON HOLD." data-quant proved `region_aggregates` is **404 in prod** (R1 §A.1). The SEO surface is the right Realtor.ca-traffic play but it has no data table to render and (compliance Ruling 2) must be active-IDX-aggregate-only with no LLM copy. Fund the active-IDX aggregate build *after* D; do not roadmap it as launch.
- **HOLD/fast-follow on H (underwrite-the-map)** — it's the north-star magic moment but gated on D's rent model. Correctly downstream; don't let it jump ahead of G.
- **RE-SCORE J (heat layer) to fast-follow, not launch** — compliance Ruling 1 makes the *active* heat layer SAFE-public and it's a real "beats HS's silently-truncated map" win, but it competes with G for the same Phase-2 attention and G is the sharper wedge. Ship J right after G.
- **Holding `data-quant` to ballot item B (retire fake `ExtrapolatedCapRate`).** This is a **competitive** issue, not just data hygiene: we market "institutional-grade shadow data," and `ExtrapolatedCapRate` is `f(ListPrice)` with a static $5,500 rent for every property (data-quant R0 §7) — a $400k condo and a $400k bungalow get the same "cap rate." One power-user screenshot of that math on a forum torpedoes the entire positioning with the exact analytical audience we court. data-quant already endorses retiring it (R1 §C); I'm putting it on the record as a launch-blocker for any yield claim. **Kill or honestly relabel it before G ships, because G ships into the same forums where the fake number would be caught.**

---

## 4. Confirmation: my two real-data wedges map to G and I

✅ **True DOM across relist chains → G** (ballot Phase 2). Populated today (214k `property_sale_history`, confirmed VOW-derived/gated via growth's code check: `sync.ts:130/384-410`, comment :117 "stitch ACROSS feeds").
✅ **Condition-aware glass-box AVM → I** (ballot Phase 3). Real AVM (~11.4% MAE); `AVMAdjustmentBreakdown` exists; gated per compliance Ruling 4.

Both are *exposure of existing edge*, not new engines — consistent with product-ux's "distribute, don't add" thesis I conceded in R1. My demoted R0 Move 3 (underwriting terminal) = ballot **H**, correctly gated on **D**.

---

## 5. Dissent

**None on substance.** I endorse the consensus (Flipper-first beachhead, cut Builder, open-lobby-gate-vault, stabilize-first). One **recorded emphasis, not a dissent:** the launch narrative must visibly *lead with G* (True DOM / distress), not present F (the open terminal) as the headline. F is the delivery vehicle; G is the reason to care. If the synthesis frames "we opened the terminal" as the story, we've described plumbing, not a wedge — the story is "we expose the seller's true desperation and the renovated-vs-gut truth that HouseSigma's own marketing admits it can't." Plumbing (A, F, E) ships first in *time*; the wedge (G, then I) leads in *message*.

---

### Concessions carried from R1 (still standing)
- Front-door rope → conceded to growth (active terminal open; compliance Ruling 5 confirms SAFE).
- Underwriting terminal runs on fake yield today → conceded to data-quant; demoted to H, gated on D.
- Distribution of existing edge > new engines → conceded to product-ux; my wedges (G, I) are exposure, not new metrics.
- Cut Builder → endorsed persona. Beachhead ordering reconciled: **Flipper-first by data-readiness, Cashflow-destination on D landing** (now council consensus per ballot).
