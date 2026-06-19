# R2 — Growth (reconciliation)

**Author:** `growth` · Round 2 · Read R2-BALLOT.md + all R1 files. Scoring: **Impact (1-5) × Effort (S/M/L) × Compliance (Safe/Gated/Forbidden)**.

I lost two arguments cleanly in R1 and won the one that mattered (the front-door rope). This round I endorse the ballot's phasing, resolve my two assigned Open Qs with evidence, and rank.

---

## 0. Endorse the phasing (A→B→C / D+E / F+G+H / I-M)

**Endorsed, with one correction to the consensus.** The ballot's A→B→C, then D+E, then F+G+H ordering is right and I won't relitigate it. `data-quant` + `perf-arch` are correct that **prod is 502 and that gates everything** — no growth move matters if the terminal doesn't load. I concede my R0/R1 implicit assumption that "the data is mostly there, just needs surfacing" was wrong: `data-quant` proved yield tables 404, Typesense 502, and corrected my `region_aggregates` claim (see Q#2). **Phase 0 stabilize is genuinely #0, ahead of every loop I proposed.**

The one correction: **K (referral invites) does NOT belong in Phase 3.** It has zero data dependency and zero compliance surface (`data-quant` scored it 🟢 GREEN "ship anytime"; my compliance Q#3 to `compliance` confirms it's our own account-provisioning). It should ship **in parallel with Phase 1**, seeding the invite graph while the rent model is built — so the loop is primed the day the Flipper wedge (G) lands. Moving K earlier costs nothing and compounds.

---

## 1. OPEN Q#1 — the anon discovery hook, given active *analytics* still hit §6.2(f)

`compliance` Ruling 5 condition #4 settled the exact boundary, and it's **better than `competitive` feared.** The line is not "active data only / no analytics" — it's **per-listing display-computations (SAFE) vs active-dataset aggregations into a new analytic (gated/aggregate).** Verbatim from Ruling 5 #4: *"a per-listing carrying-cost off list price + tax is a display computation, not a dataset derivative... But anything that aggregates the active dataset into a new analytic ('cheaper than 80% of the neighbourhood') leans on IDX §6.2(f) which has no carve-out."*

So the **anon discovery hook that survives** — and it is *not* "just another listing browser". Structured as the **3-layer teaser spec** (the lead's frame), the wedge is **Layer 3**:

- **Layer 1 — Passthrough facts (SAFE).** Address, list price, beds/baths, sqft-bucket, raw feed `DaysOnMarket`, **brokerage**. Licensed IDX display. *This is table-stakes; Realtor.ca/HouseSigma have it too.*
- **Layer 2 — Per-listing display-computations (SAFE).** Per-listing price-drop fact ("↓ $40k since listed") + carrying cost ($/mo). Computed on the single listing's OWN fields → display, not a dataset derivative (Ruling 5 #4). *A modest edge — HouseSigma shows current DOM but not a clean per-listing carry/compression line.*
- **Layer 3 — Aggregate-VOW teaser (SAFE PUBLIC) = THE WEDGE.** "7 sold firm in 30d · median True-DOM 41d · 3 under ask on this block" — count/distribution only, min-N≥5 (Ruling 1 + compliance Move 1). *This is the differentiator: Realtor.ca structurally can't show it (no sold data); HouseSigma gates the same data but teases it as a bland paywall ("sign up to see sold price"). We tease it as **insight**. The row-level numbers (True DOM, AVM, sold comps) unlock behind the gate.*

| Anon-visible element | Source | Ruling |
|---|---|---|
| Address, list price, beds/baths, sqft-bucket, raw feed `DaysOnMarket`, **brokerage** | IDX passthrough | SAFE (Ruling 5; §6.3(f) field display) |
| **Per-listing price-drop fact** ("↓ $40k since listed" = this listing's own `OriginalListPrice − ListPrice`) | IDX, single-listing display computation | SAFE (Ruling 5 #4 — *"price vs its own list history... OK to show"*) |
| **Per-listing carrying cost** (list price + tax → $/mo) | IDX, single-listing display computation | SAFE (Ruling 5 #4 explicit) |
| **Aggregate-VOW teaser** ("7 sold firm in 30d · median True-DOM 41d · 3 under ask on this block") | VOW, count/distribution only, min-N≥5 | SAFE PUBLIC (Ruling 1 + compliance Move 1) |
| Active-IDX **count/heat layer** beneath the ≤100 pins | IDX aggregate | SAFE PUBLIC (Ruling 1; J) |

**The loop that works on this alone:**
1. **Discover (public):** anon lands in the terminal (F) defaulted to the **Flipper view** (per my product-ux concession — TrueDom column is gated, but the *view's framing* is distress; the public surface shows per-listing price-drop + carry + the aggregate-VOW teaser). The teaser is the hook: HouseSigma's gate says "sign up to see sold price"; ours says **"7 sold firm in 30d, median True-DOM 41d, 3 under ask"** — insight, not a paywall (`competitive` + `compliance` both rate this the single best gate-promise in the council).
2. **Tease (public):** every listing card shows the price-drop fact + carry cost (SAFE display-computations) and an aggregate "comps suggest…" line. The *number* that matters (row-level True DOM, the relist chain, AVM) is one tap away behind "Apply for Terminal Access."
3. **Convert (gate):** the application proves bona-fide interest (§3.2, which we're *required* to establish) AND seeds the persona dashboard (`persona`'s personalization moat — conceded, see §3). The vault unlocks True DOM, sold comps, AVM, glass-box breakdown.
4. **Retain (gated):** watchlist + saved-search distress alerts (the habit loop) — *conditional on product-ux wiring the real save spine (D), which `persona` and I both rank a launch blocker.*
5. **Refer/Share (K + active-Deal-Card):** invitee skips the queue; the shared Deal Card carries active-deterministic facts + brokerage only (Ruling 3 SAFE), with the AVM/True-DOM number unlocking behind the gate.

**This answers `competitive`'s "generic-middle" objection:** the anon surface is differentiated not by *richer active metrics* (mostly forbidden, they were right) but by the **aggregate-VOW teaser** — a thing Realtor.ca structurally can't show (no sold data) and HouseSigma won't tease with insight (bland paywall). The wedge is the *promise of the vault*, surfaced as a safe aggregate, not the active data itself.

**Concession logged:** I withdraw "True DOM on active, cap-rate-on-list" from the anon hook (conceded to `competitive` + `compliance` + `data-quant` in R1; verified True DOM stitches `raw_vow_sold` across feeds, `sync.ts:130/384-410`). The anon hook is thinner than my R0 drew — but with the aggregate teaser it's still a wedge.

---

## 1b. The LOCKED funnel-flip dependency chain (F) — liftable for synthesis

This is the agreed sequencing from my convergence with `product-ux` + `persona` + `compliance`. **F does not ship until each link is satisfied — in order:**

1. **First-run / anon default view = `flippers` persona.** Verified in `personaConfig.ts`: the `flippers` config sorts by + map-colors by `TrueDom` with columns `trueDom`/`priceDrop`/`carryCost` — every field `data-quant` confirmed real & populated (R0 §2). The `cashflow` config (`:272-280`) sorts by + map-colors by the **fake** `ExtrapolatedCapRate` → it must NOT be the default. *(Note: row-level `TrueDom` itself is VOW-derived = gated per compliance; the anon PUBLIC surface shows the §1 safe set — per-listing price-drop fact + carry cost + aggregate-VOW teaser — within the distress-framed Flipper view. The full True-DOM number unlocks behind the gate.)*
2. **GATE the Cashflow view** behind **(a)** `data-quant`'s real rent model (D) AND **(b)** the **P0 fake-`ExtrapolatedCapRate` kill** (B — stop displaying it; the UI already falls back to "—"). No cold visitor ever sees a fabricated cap rate. Cashflow becomes the default-eligible view only once both land.
3. **Do NOT drive paid/forum/SEO traffic at F until** (E) the listing-detail page is ISR-cached (`perf-arch` — today it's `force-dynamic` with a live ProptX call + per-request AVM; crawlers + viral links are a scale bomb and tank the CWV the SEO needs) AND (M) the minimal responsive Map/List toggle exists (a desktop-only terminal, `page.tsx:272`, leaks ~60-70% mobile traffic — see my §6 tripwire).

**Plain-English chain:** `B (kill fake number) + default→flippers` → flip the homepage (F, anon active terminal + aggregate teaser) → `K` invites in parallel → unlock Cashflow only after `D` (rent model) → only THEN open the traffic taps, after `E` (ISR) + `M` (mobile floor). The compliance gate (sold/AVM behind `requireConsumer`, `VOW_ENFORCE_TERMS=true` per C) is constant throughout.

---

## 2. OPEN Q#2 — Investor-Lens SEO (L): build the active-IDX aggregate, or cut?

**Position: do NOT cut L. But it is Phase 3, gated on a small bounded build — and `data-quant` and I were BOTH imprecise about the data.** I verified the migration on disk:

- There is **no `region_aggregates` table** — by design. Migration `020_region_aggregates.sql` ships two columns on `listings` (`extrapolated_cap_rate`, `city_region`) + an **RPC `region_active_aggregates(p_region)`**. `data-quant` queried for a *table* and correctly got 404; my R0 named it wrong (and called an RPC a table). **We were both right and both wrong** — the *table* doesn't exist; an aggregate *RPC* does.
- **Two hard limits make the RPC unfit for SEO as-is:** (a) it returns **one region's scalars per call** — fine for a dashboard scorecard, useless for statically generating hundreds of indexable pages; (b) its **cap-rate columns aggregate the FAKE `ExtrapolatedCapRate`** (static $5,500 rent) — so any "best cap rates in [city]" page would broadcast fiction, exactly the credibility landmine `data-quant`/`persona` warn against.

**So my position, concretely:**
- **CUT the yield/cap-rate SEO pages entirely until the rent model (D) lands.** Non-negotiable — I will not market fake numbers (conceded to `data-quant` in R1, reaffirmed).
- **FUND a small batched ETL** that materializes per-region **inventory + distress** aggregates into a real table/JSON for static generation: active count, **% price-cut**, median list price, list-price distribution, raw-DOM distribution, months-of-supply (active ÷ sold-velocity — the sold side is a count, SAFE per Ruling 1). All **honest today**, all active-IDX + aggregate-VOW-counts, all inside `compliance` Ruling 2's five conditions (active aggregates, no per-listing enumeration, brokerage+notices, **no LLM in copy — templated prose only**, no gated numbers in email).
- **Where it ranks:** the long-tail analytical query Realtor.ca and HouseSigma *don't* target — *"[city/neighbourhood] real estate price cuts / months of supply / stale inventory / investor market report."* Consumer-listing portals rank for "[city] homes for sale"; nobody owns "[city] **distress/inventory analytics**." That's our SEO lane and it's honest on day one *for the distress edition*, yield edition post-D.

**Net:** L is real, but it's a **Phase-3 build on a Phase-1 dependency (rent model for the yield half) plus a new small aggregate ETL (for the distress half)**. Not a phantom, not free. The weekly report (also L) ships its **distress/inventory edition in Phase 2** (honest now) and adds the yield edition post-D — `data-quant` scored this 🟡 CONDITIONAL and I accept that split.

---

## 3. Where I concede (R1 losses, logged)
1. **Public AVM hook — DEAD** (compliance FORBIDDEN + data-quant fake). Reshaped to aggregate teaser. *(R1)*
2. **"True DOM on active" anon bait — WITHDRAWN** (VOW-derived, verified in code; conceded to competitive). *(R1)*
3. **Yield-led SEO/Deal-Cards — DEFERRED** behind the rent model; won't market fake numbers (conceded to data-quant). *(R1)*
4. **Sequence — CONCEDED:** Phase 0 stabilize → Phase 1 de-fake → Phase 2 loops. My loops front-ran the data. *(data-quant)*
5. **Persona-personalization survives the funnel-flip — CONCEDED to `persona`:** anonymous-first is fine, *generic*-first is not. The funnel-flip's first interaction is a **one-tap persona pick** that reshapes the view (F as balloted), and the application still seeds the persona dashboard. I adopt `persona`'s synthesis wholesale — it's strictly better than my "drop into a generic terminal" framing.
6. **Weekly report prose is TEMPLATED, not LLM-generated** — conceded to `compliance`'s direct challenge (§6.2(k)/§4). No listing data through an LLM, ever.
7. **Deal Card "deterministic = safe" framing — CORRECTED:** conceded to `compliance`'s two-axis test. Determinism satisfies the no-LLM axis only; VOW-derived content is gated regardless. Public card = active facts + brokerage only.

---

## 4. My ranked top-5 (of A–M)

| Rank | Move | Impact | Effort | Compliance | Why this rank (growth lens) |
|---|---|---|---|---|---|
| **1** | **A. Stabilize prod** | 5 | S–M | Safe | Conceded to perf-arch/data-quant: a 502 terminal converts 0% of every channel I drive. Every growth dollar is wasted until this lands. Not my move, but #1 on my ballot. |
| **2** | **F. Open the lobby, gate the vault** (anon active terminal + one-tap persona pick + aggregate-VOW teaser) | 5 | M | Safe (4 conditions, Ruling 5) | *My* core move, now de-risked: it's the shipped state + a homepage flip. Cuts TTV-to-first-signal 3min→3sec. The aggregate teaser is the wedge. Gated behind B (fake-number kill) + default-to-Flipper-view. |
| **3** | **K. Referral invites + active-deterministic Deal Card** | 4 | S–M | Safe (Ruling 3) | The launchable loop with **zero data dependency** (data-quant 🟢). Double-sided invite codes turn the mandatory velvet rope into currency; the active-facts Deal Card is the viral unit our personas already paste into BiggerPockets/REIN. Ship in parallel with Phase 1. |
| **4** | **D. De-fake (rent model + trust-spine/watchlist)** | 5 | M–L | Gated (rent provenance) | The keystone dependency. It's not "my" move, but it's the gate that converts my loop from distress-acquisition to "the cashflow terminal investors open every morning," AND fixes the dead watchlist heart that kills my retention loop. I'm putting it on the **growth** critical path. |
| **5** | **G. Flipper launch wedge** (True DOM + distress + Capital Burn badge, gated) | 4 | M | Gated (VOW-derived, behind requireConsumer) | The real, populated-today edge behind the gate — the payoff the anon teaser promises. It's what makes the application worth completing. Beachhead persona = Flipper (4-agent consensus). |

**Just below the line:** **C** (`VOW_ENFORCE_TERMS`=true — cheapest compliance precondition, ship in Phase 0; I rank it a must but it's compliance's to own) · **M** (mobile floor — I argue it's a growth-blocker not just polish: it's the denominator on every channel link I drive; persona demoted it to fast-follow with a mobile-*readable* card at launch, which I accept as the minimum) · **J** (public active heat layer — strong "show more without breaking the 100-cap" + out-scans HouseSigma's truncated map; fast-follow).

---

## 5. Re-scores / cut / add
- **CUT from launch:** Builder persona + Builder-SEO (endorse `persona` + `competitive` — I withdraw the "Builder zoning SEO" angle from my R0 Move 3; it's hollow AND IDX-no-carve-out, double-fault).
- **RE-SCORE K upward / earlier:** ballot files it Phase 3; it's the only Phase-1-shippable loop (zero data dep). Move to Phase 1-parallel.
- **RE-SCORE L:** keep, but split — distress/inventory edition is Phase 2 (honest), yield edition Phase 3 (post-D). Not a cut, not a phantom; a bounded aggregate-ETL build.
- **ADD (small):** un-disallow `/share/` in `robots.ts` **only** for active-deterministic shared collections so the viral Deal Card can be indexed/previewed — *conditional on `compliance` confirming an active-facts+brokerage share page is OK to index* (my open Q#2 to compliance). Low effort, real loop amplification.

---

## 6. Dissent on record
**None blocking.** One **soft dissent** for the record: I think the council is under-weighting **M (mobile)** by filing it as fast-follow. ~60-70% of real-estate traffic is mobile; every forum/social/SEO link I drive lands on a desktop-only terminal with mouse-only resize (`page.tsx:272`, `:119-137`). I accept `persona`'s compromise (mobile-*readable* listing/distress card at launch, full Pocket Terminal fast-follow) as the minimum viable floor — but I want it recorded that **if launch traffic is mobile-heavy and only a read-only card exists, the funnel-flip's conversion will underperform its desktop numbers**, and M should be re-prioritized the moment that shows in the data. Not a blocker; a tripwire.

---

*Endorsing for R3:* A (#0) → B/C → D+E → F+G+(K parallel) → H → I/J/L/M. Beachhead Flipper, destination Cashflow, Builder cut, rope at the vault not the door, loops on real data only.
