# R1 — Growth (cross-examination)

**Author:** `growth` · Round 1 · Read all seven R0 files.

The lead is right: I'm outnumbered on the rope and `compliance` killed the public-AVM hook outright (VOW §6.2(f) both qualifiers + Purpose §3.2). Good. Those are the *wrong* versions of my ideas. This round I defend the survivable version, concede what I lost, and resolve the data-honesty question `data-quant` is right to raise.

---

## A. The single most important reframe: "funnel-flip" was the wrong word. It's "open the lobby, gate the vault."

`competitive` and `persona` both heard "lower the rope → chase mass reach → generic middle." That is a strawman of what the code already does. **Three facts settle this:**

1. **The active-listing terminal is ALREADY public and indexable today.** `robots.ts:5-21` allows `/properties`; `sitemap.ts:18-33` emits up to 45k `/properties/{key}` pages. `compliance` R0 §2 confirms this is **SAFE** ("the only growth lane where Compliance says 'go bigger'"). So I am not proposing to *lower* anything — I'm proposing to **stop the homepage from hiding the one surface compliance already blessed.** The homepage (`page.tsx:58-67`) funnels every visitor into the `/apply` wall even though the licensed public terminal sits one click away.
2. **The rope stays exactly where `competitive`, `persona`, and `compliance` want it** — at the sold/AVM line, enforced by `requireConsumer`/`VowGateOverlay`. Density positioning is untouched. The top-1% still must apply to unlock the vault.
3. **`compliance` and I independently converged on the identical move.** Their R0 Move 1 ("the velvet rope IS the moat — aggregate teaser, unlock behind the gate") and Move 2 ("go ALL-IN on programmatic SEO of the active IDX feed") **are my Move 1 and Move 3, written by the risk owner.** When the compliance veto-holder hands you the compliant version of your own play, the debate is over — adopt it.

**So the consensus shape is:** anon → public active-IDX terminal with deterministic active metrics + an **aggregate sold/distress teaser** (counts, not rows) → "Apply for Terminal Access" to unlock VOW row-level + AVM. The application still proves bona-fide interest (§3.2) and still captures the rich intent data (`apply/page.tsx:244-253`) — it just fires *after* the magic, not before it. TTV to first-signal goes from ~3 min (form+magic-link) to ~3 sec.

---

## B. Cross-examination of peers

### vs `competitive` — I challenge your core dichotomy (direct message sent)
You wrote the only winning lane is "density for the top 1%, not mass reach," and bucketed my funnel-flip into the losing one. **You can't have your moat and refuse to let anyone touch it.** Your Move 1 (True DOM badge), Move 2 (Force-Appreciation), Move 3 (underwriting terminal) are all *experiences*. An experience nobody can have before a 3-step form + magic-link converts only people who already trust us — which, pre-launch, is **nobody**. Density is *what we sell*; it is not *how we get discovered*. Discovery is free active-listing signal (True DOM on active, price-compression-vs-list, carry cost) that makes a cold investor think "these people see things HouseSigma doesn't" — *then* the rope. **Concession I'll make to you:** you're right that I must NOT pitch "Realtor.ca-scale reach" or a public AVM. I never wanted the AVM public; I'll strike any language implying mass-consumer chase. We're closer than your R0 framing assumed.

### vs `compliance` — I adopt your envelope wholesale; one question outstanding
Your SAFE/GATED/FORBIDDEN box is the law I design inside. I have **dropped the public-AVM hook entirely** — conceding the exact idea you pre-emptively vetoed (your R0 §5). I've asked you (direct message) for an explicit ruling on **Deal Card OG exports** so I can finalize the loop:
- **(1a)** Deal Card with ONLY active-IDX-deterministic fields (list price, True DOM, price-drop, carry cost, cap-rate-on-*list*) + brokerage → SAFE to share to a logged-out recipient / put in an OG image?
- **(1b)** Deal Card showing AVM/Value-Add $ figures → my read of your rule = **FORBIDDEN** off-VOW to a non-consumer. I'll drop that variant on your confirm.
- **(2)** Adding a CTA + referral attribution to the already-robots-disallowed `/share/[token]` page, kept active-IDX-only → still SAFE?
- **(3)** Invite-code mechanics (verified user gets N codes; invitee skips review queue) → purely our account provisioning, out of your scope?
My R2 shortlist will be conditioned on (1a)=SAFE, (1b)=FORBIDDEN, (2)=SAFE, (3)=out-of-scope.

### vs `data-quant` — you win the sequencing argument. I will not market fake numbers.
This is the most important correction to my R0. You proved (live, with 404s) that `gross_yield_est` / `cap_rate_est` / `net_monthly_cashflow` are **structurally empty** (`rental_market_index`, `city_region_avg_price`, `municipal_mill_rates` all 404), and that `ExtrapolatedCapRate` is `f(ListPrice)` cosplaying as yield (static $5,500 rent for every property, `ExtrapolatedCapRateEngine.ts:61-92`). **A growth loop built on that burns the exact analytical audience the first time they check the math.** I concede fully. So I'm splitting my surfaces into **runs-today** vs **gated-on-your-Move-1 (real rent model)**:

| Surface | Honest data it can show TODAY (no rent model) | Blocked until rent model (your Move 1) |
|---|---|---|
| **Investor-Lens SEO pages** | Active inventory counts, list-price distribution, True-DOM distribution, price-cut %, suite-candidate stock — all aggregate active-IDX (compliance SAFE) | "Best cap rates / cash-on-cash in [city]" — DO NOT SHIP until yield is real |
| **Weekly report** | "X new under-ask in Peel; median True-DOM 41d; N price cuts this week" — distress/temperature, deterministic | Yield rankings, cashflow leaderboards |
| **Deal Card** | List price, True DOM, total price-drop, carry/Capital-Burn, cap-rate-on-LIST (clearly labeled "on list price, not modeled rent") | Real cap-rate / monthly-cashflow / AVM upside |

**My loop launches on True-DOM + distress + inventory signal (all real, all populated, all active-IDX), not on yield.** Yield joins the loop the moment your Move 1 lands — and your Move 1 becomes the **#1 growth dependency**, not just a data fix. I'll argue in R2 that it's on the critical path *for growth*, which strengthens your case.

### vs `persona` — your beachhead helps my targeting; I'll refine one thing
You pick **Cashflow Investor** as the beachhead. Strategically that's clean and it sharpens my channels (BiggerPockets Canada, REIN, Ontario landlord FB groups are *cashflow-investor* watering holes — [BiggerPockets Canadian investors](https://www.biggerpockets.com/forums/48/topics/1211731-canadian-real-estate-investors)). **But** your own R0 says the Cashflow magic moment ("re-color the map by MY cash-on-cash") **does not work** because yield is empty — same blocker `data-quant` found. So the beachhead persona's hero feature is gated on the rent model too. **Refinement:** for the *launch* distribution wedge, lead with the **Flipper/Deal-Hunter** signal (True DOM / distress — which IS real and populated per your R0 §2 and `data-quant` §2), *while* building toward the Cashflow beachhead. The flipper signal is what's shippable into forums today; cashflow is the obsession we earn once Move 1 lands. I'll support your "cut Builder from launch" 100% — shipping a visibly-fake developer tool (`BuilderAnalyticsEngine.js` hardcoded `multiplexByRight=false`) would poison credibility in the exact forums I want to seed.

### vs `product-ux` — strong alignment; I escalate one of your findings to a growth-blocker
Your thesis ("distribute existing edge, don't add more") is my thesis on the product side. But three of your findings are not UX polish — they are **growth-loop-killers**, and I want them re-prioritized as such:
- **No mobile terminal at all** (`page.tsx:272`, zero responsive primitives). ~60-70% of real-estate traffic is mobile; every forum/social link I drive lands on a broken phone layout. **My entire acquisition strategy leaks out the bottom of a desktop-only funnel.** This isn't "nice to have" — it's the denominator on every channel I propose.
- **The ledger save-heart is fake** (`LedgerRow.tsx:107,159-167` — local state, evaporates on refilter) and the drawer's Watchlist/Schedule buttons are dead (`ListingTerminal.tsx:527-532`). The watchlist + alert pipeline (`scripts/worker/alerts.ts`) is the **retention engine** of my loop — a daily reason to return. If the save action silently no-ops, there is no retention loop to drive.
- **`/share/[token]` has no conversion CTA** (your audit + my R0). It's a dead-end leaf on what should be the viral edge.

I'll back-stop your Move 1 (mobile) and Move 3 (wire the save spine) as growth prerequisites in R2.

---

## C. What I concede (where I lost)
1. **Public AVM hook — DEAD.** Conceded to `compliance` (forbidden) and `data-quant` (numbers aren't even real yet). Reshaped into the **aggregate public teaser** (counts/distributions, SAFE per compliance §2) with the real number behind the gate.
2. **"Funnel-flip" as worded — withdrawn**, replaced with "open the active lobby, gate the vault" — which is the shipped architecture, just surfaced from the homepage. No rope-lowering, no mass-reach pivot.
3. **Yield-led SEO / Deal Cards — deferred.** Conceded to `data-quant`: my loop launches on True-DOM/distress/inventory (real) and adopts yield only after the rent model (Move 1) is built. I will not market fake cap rates.
4. **Beachhead = Cashflow, launch-wedge = Flipper signal** — refined per `persona` + `data-quant`'s populated-data reality.

---

## D. My revised three moves (preview of R2 ranking)
1. **Open the lobby, gate the vault** + **aggregate sold/distress teaser** on the public terminal (= my old Move 1 ∩ compliance Move 1). Runs today on active-IDX + aggregate counts. *Depends on: product-ux mobile + save-spine fixes.*
2. **Active-IDX programmatic "Investor-Lens" SEO + weekly distress/inventory report**, seeded into BiggerPockets/REIN/landlord FB (= my old Move 3 ∩ compliance Move 2 ∩ data-quant's "honest data only"). Runs today on aggregate active data; **adds yield pages only post-rent-model.**
3. **Deal-Card referral loop on active-IDX data** (invite codes that grant queue-skip status + a branded active-listing Deal Card with conversion CTA on `/share`). Conditioned on compliance ruling (1a)=SAFE. **Drops the AVM-card variant.**

**Cross-cutting dependency I'll put on the critical path in R2:** `data-quant`'s rent model is the gate that converts my loop from "distress-signal acquisition" to "the cashflow terminal investors open every morning." It is the highest-leverage *growth* investment, not just a data chore.

---

*Sources:* [BiggerPockets Canadian investors](https://www.biggerpockets.com/forums/48/topics/1211731-canadian-real-estate-investors) · [HouseSigma ON reports](https://housesigma.com/on/reports) · peer files R0-compliance.md (§2 SAFE/GATED/FORBIDDEN box), R0-data-quant.md (§B.6-7 empty/fake yield), R0-persona.md (beachhead), R0-competitive.md (density-vs-reach), R0-product-ux.md (mobile + save-spine).
