# R2 — `persona` (Investor-Persona Advocate) · Reconciliation

I read `R2-BALLOT.md` and all `R1-*.md`. I own **Open Q#5 (lock the consensus)** and rank the ballot through the Flipper's eyes. Concessions logged at the end.

---

## OPEN Q#5 — LOCKED. No remaining dissent. (My assigned call.)

I am the persona advocate and this is my domain to close, so I'm closing it decisively:

- **Flipper / Deal Hunter = LAUNCH beachhead. ✅ LOCKED.** Backed by real, populated-today data (True DOM, price drops, IsStale, Capital Burn, 214k sold chains). `competitive`, `data-quant`, `growth`, and I all converged independently. I conceded my R0 Cashflow-first pick; the concession stands.
- **Cashflow Investor = DESTINATION persona. ✅ LOCKED.** Unlocks the day `data-quant`'s rent model (Move D) ships. Same human, later door.
- **Builder = CUT from launch. ✅ LOCKED.** Zero peers defended it across two rounds; `competitive` (R1 §2) and `growth` (R1 §B) explicitly endorsed the cut. Hollow data (`multiplexByRight` hardcoded false) + IDX has no analytics carve-out (`compliance` Ruling 5 #4). Dead.

**There is no remaining persona dissent on these three. The council can treat them as settled.** The only persona-side refinement I add below is the Smart Homebuyer's launch role (top-of-funnel, not a metric build).

---

## The critical constraint that reshapes my ranking: the Flipper's magic moment lives BEHIND the gate.

`compliance` Ruling 5 #4 (R1) is the most important thing that happened this round for my persona, and it changes the answer to the lead's question:

> **True DOM is VOW-derived → GATED. It cannot be shown to an anonymous user.** Active-only DOM/analytics hit IDX §6.2(f) (no carve-out).

So the Flipper's *differentiating* magic — "True DOM 96d across 3 relistings, −$85k, this seller is bleeding" — is **a behind-the-vault experience, not a public teaser.** This is not a problem; it's clarity. It means the launch sequence for the Flipper is precisely:

1. **Public lobby (anon):** active listings + active-deterministic single-listing computations (carry cost, price-vs-its-own-list-history) + an **aggregate distress teaser** ("this block: 7 sold firm in 30d, median True-DOM 41d, 3 under ask" — `compliance` Move 1, SAFE). The teaser *shapes* the desire.
2. **The persona-pick (Move F)** frames the unlock: "You're hunting deals → apply to open the Distress Wire."
3. **Behind the gate (Move G):** the full True-DOM distress feed, row-level, the magic moment realized.

This is *exactly* the HouseSigma-beating pattern: their gate promises a bland "sign up to see sold price"; ours promises "sign up to see which sellers are bleeding, with relist-corrected DOM they can't compute." The rope becomes the reveal.

---

## Does Move F (persona-pick on first tap) genuinely beat HS's generic feed, or is it lipstick?

**It is NOT lipstick — but ONLY if it reshapes substance, and there's a real risk it degrades to lipstick. Here's the honest persona verdict.**

It is genuine IF the persona pick changes:
- **the aggregate teaser shown** (Flipper sees "3 under ask on this block"; Smart Homebuyer sees "suite-candidate stock"; the existing per-persona map color + columns in `personaConfig.ts` already do this for the gated view),
- **the default sort/lens** (Flipper → distress-led; the config already supports `sortBy`), and
- **the unlock framing** ("open YOUR Distress Wire" vs "open YOUR cashflow map").

It DEGRADES to lipstick if the pick only swaps an icon/label while every anon user sees the same commodity active feed. That's the failure mode `competitive` (R1 §1.1) rightly warned about: an open terminal showing only commodity active data has spent its differentiation.

**My ruling for the council:** Move F is worth shipping at launch *only bundled with* a persona-specific aggregate teaser (the SAFE shapes from `compliance` Move 1). Persona-pick + identical-for-everyone feed = lipstick, cut it. Persona-pick + persona-shaped teaser + persona-framed unlock = the thing that makes a cold Flipper think "this was built for me" in 3 seconds. **F is real, conditioned on G's teaser feeding it.** They are one move, not two.

---

## Does the Flipper need F + G + B before anything else? — Mostly yes, with the real ordering.

Through the Flipper's eyes, the launch-blocking set is **A → C → B → (G ∩ F)**, in that dependency order:

- **A (stabilize prod)** — non-negotiable prerequisite. A Flipper who hits a 502 on the one tool that's supposed to be "instant" never comes back. Not my domain to rank, but it's Task #0 and I endorse it absolutely.
- **C (flip `VOW_ENFORCE_TERMS` + brokerage audit)** — precondition for shipping ANY gated surface, and the Flipper's magic (G) IS a gated surface. Without C, G can't ship cleanly.
- **B (kill fake numbers)** — the Flipper is the *second-most* numerate persona (after Cashflow). A fake `ExtrapolatedCapRate` next to a real True DOM makes them distrust the real number by association. B protects the credibility of G. Cheap (1 file). Must precede launch.
- **G (Flipper distress wedge) + F (persona funnel)** — the actual magic moment + its delivery funnel. This IS the launch.

So: the Flipper needs **B (no fake numbers) and the trust-spine half of D (wired watchlist) before G lands**, then **G+F together** as the launch event. The rent-model half of D and the whole of H (underwrite-the-map) are the **Cashflow destination**, not the Flipper launch — they come after.

---

## My ranked TOP 5 (for the LAUNCH persona = Flipper)

Scored Impact (1-5) × Effort (S/M/L) × Compliance-risk.

**1. G — Flipper launch wedge (True DOM + price-drop/distress + Capital Burn).** Impact **5** · Effort **M** · **GATED** (VOW-derived, behind the vault per Ruling 5 #4).
> *This IS the beachhead magic moment.* Real data today, the one wedge HouseSigma structurally cannot match (they show per-listing DOM; we collapse the relist chain). Everything else exists to deliver this. Highest impact, period.

**2. A — Stabilize prod.** Impact **5** · Effort **S-M** · **Safe**.
> Not my domain, but ranked #2 honestly: a Flipper's entire value prop is "see the deal first, fast." A flaky 502 backend kills the wedge before it's felt. Hard prerequisite to G mattering.

**3. B — Kill fake numbers now.** Impact **4** · Effort **S** · **Safe**.
> Cheapest credibility win on the board. The Flipper checks math; a fake cap rate poisons trust in the real True DOM sitting next to it. 1-file, must-do before launch.

**4. F — "Open the lobby, gate the vault" + persona-pick that reshapes the view.** Impact **4** · Effort **M** · **Safe** (active lobby) → **Gated** (vault).
> The funnel that delivers G to a cold Flipper at ~3s TTV, and the thing that makes the product feel built-for-me vs HS's generic feed. **Conditioned on carrying a persona-shaped aggregate teaser** (else it's lipstick — see above). Resolves the growth-vs-me fight: anon-first, never generic-first.

**5. D (trust-spine half only) — wire the real watchlist everywhere, kill dead buttons.** Impact **4** · Effort **S-M** · **Safe**.
> A Flipper's core habit is "save the buy-box, get alerted when a seller cracks." `LedgerRow.tsx:107` fake heart + dead drawer buttons = the product looks like a prototype to a skeptical analyst. The alert pipeline is the Flipper's retention loop. (I rank only the trust-spine half here; the rent-model half of D is Cashflow-destination, not Flipper-launch.)

**Just below the line (Flipper fast-follow, not launch):**
- **J (active heat layer)** — great "show more without breaking the 100-cap" for the Flipper's map scan; `compliance` blessed the active tier as SAFE. Fast-follow.
- **K (active-deterministic Deal Card + invite codes)** — the Flipper-distress card is the natural viral artifact (they already screenshot deals into BiggerPockets), and `compliance` Ruling 3 cleared the active-deterministic version. Fast-follow once G ships.
- **M (mobile-readable card)** — the Flipper's glance-in-the-field need; demoted correctly to fast-follow.

**Destination-persona moves (Cashflow, post-rent-model — NOT in my launch top-5):** D's rent-model half, **H (underwrite-the-whole-map)**, **I (glass-box AVM)**. All high-impact, all gated on Move D's rent model. H is the eventual north-star, but it serves the *destination* persona, so it does not rank in the *launch* persona's top-5.

---

## Cut / add / re-score flags

- **CUT: Builder, in all forms** — persona switcher (`personaConfig.ts:316`), apply objective (`apply/page.tsx:48-50`), AND `growth`'s Builder-SEO page idea (L). Locked.
- **RE-SCORE F:** the ballot lists F as one move; I'm flagging that **F without a persona-shaped teaser is lipstick** and should not score above a 2. F + teaser scores a 4. Bundle them or downgrade F.
- **RE-SCORE H downward for the LAUNCH window:** H is a 5 for the Cashflow destination but a non-starter for launch (depends on D's rent model + serves the wrong persona for the beachhead). Don't let its eventual-brilliance pull it into the launch sprint ahead of G.
- **ADD (small): the Smart Homebuyer's launch role is top-of-funnel SEO, not a feature build.** The reframe I proposed ("real monthly cost with a basement tenant") is a *fast-follow*; at launch the Homebuyer's job is to feed `growth`'s active-IDX SEO pages (Ruling 2 SAFE) that funnel into the gated Flipper/Cashflow magic. No new engine needed for launch.

---

## Concessions logged (where I lost / moved)
- **Conceded my R0 Cashflow-first beachhead** to `data-quant` + `competitive`: sequenced to Flipper-first by data-readiness. Held.
- **Conceded "funnel-flip" is not the generic-middle trap** to `growth` + `compliance`: the active lobby is already licensed-public; my objection narrows to "never *generic*-first," which `growth` adopted ("open the lobby, gate the vault" + persona-pick).
- **Conceded to `product-ux`** that distributing existing edge (trust-spine, wired watchlist) outranks new persona metrics at launch.
- **Accepted `compliance` Ruling 5 #4**: the Flipper's True-DOM magic is gate-only, not a public anon metric — which I've folded into the launch sequence rather than fighting.

**No dissent to register.** I endorse the ballot's phasing (A→B→C / D+E / F+G+H) with one correction: split D so its trust-spine half is a Flipper-launch blocker while its rent-model half is the Cashflow-destination trigger; and bundle F's persona-teaser so F doesn't degrade to lipstick. Idle for R3.
