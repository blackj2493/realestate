# R0 — `persona` (Investor-Persona Advocate)

**Lens:** user job-to-be-done, not implementation. I judge whether shipped features deliver a *magic moment* for a sharply-defined user, and I kill anything generic. I skimmed code only to ground claims.

**One-line verdict:** PureProperty has built four *cosmetically* differentiated personas (real per-persona filters, columns, sort, map color in `src/lib/personas/personaConfig.ts`) on top of **one genuinely defensible engine (the underwriting/deal-score stack) and two hollow ones (Builder zoning, Cashflow yield).** It is spread across four users and has won zero. **Pick one. Win it completely.**

---

## Per-persona: job-to-be-done, magic moment, and the real gap

### 1. Cashflow Investor — "Will this property feed me or bleed me, today, at my numbers?"
- **Magic moment:** Type my down-payment % and rate once; every listing on the map instantly re-colors by *my* cash-on-cash, and the list sorts by it. I find the 3 cashflow-positive doors in a sea of red.
- **What's shipped & GOOD:** `UnderwritingSandbox.tsx` is the single best thing in the product. Live cap rate, cash-on-cash, DSCR, NOI, monthly cashflow, saveable named scenarios, deterministic engine (`computeUnderwriting`). This *is* a magic moment — **on one listing page.**
- **The gap that kills it:** The terminal-wide promise is hollow. Per `personaConfig.ts:13-17` and verified live, `gross_yield_est` / `cap_rate_est` / `net_monthly_cashflow` are **all 0 in the index** — only `ExtrapolatedCapRate` (one static extrapolated number, blind to *my* leverage) is filterable. The Cashflow persona's "Yield" column (`personaConfig.ts:276`) is a **misnomer that re-displays cap rate**. So the investor's actual job — "filter the *whole map* to MY cashflow-positive deals" — does not work. The magic is trapped on the detail page; the funnel that gets them there is fake.

### 2. Flipper / Deal Hunter — "Show me the motivated seller before the other 50 flippers see it."
- **Magic moment:** A live "distress feed" — this listing has been relisted twice, cut $80k, sat 140 *true* days (not the MLS-reset 12). That asymmetry is the whole game.
- **What's shipped & GOOD:** This is the **most real persona.** `TrueDom`, `TotalPriceDrop`, `IsStale`, `CapitalBurnRate` are populated and filterable (`personaConfig.ts:290-302`); True DOM + sale-history stitching shipped (migration 018, 212k rows). True DOM that defeats the agent relist-reset trick is a genuine HouseSigma-beater.
- **The gap:** It's a *filter*, not a *feed*. A flipper's job is "tell me the *moment* a price drops or a stale listing crosses my threshold" — that's a push alert, not a slider they have to re-run. Watchlist alerts exist but are price-drop digests on *saved* listings, not a standing "any new distress in Peel under $900k" net.

### 3. Smart Homebuyer — "Don't let me overpay in a bidding war, and find the basement that pays my mortgage."
- **Magic moment:** "This 3-bed has a separate side entrance + ceiling height → legal basement suite that rents for $1,800 → your real monthly cost is $1,400, not $3,200." Nobody shows this.
- **What's shipped & GOOD:** Suite/duplex candidate flags (`SuiteStatus`, `multi_unit_status`), Deal Score (`DealScoreCard.tsx`) with transparent component breakdown, Underwriting Sandbox doubling as a "true cost of ownership" tool. Strong.
- **The gap:** It's framed as *investor* tooling (cap rate, DSCR) bolted onto a homebuyer. The homebuyer doesn't think in DSCR; they think "what's my real monthly payment after the basement tenant?" The framing is wrong, not the data. Also `is_density_ready` (the suite signal feeding "Duplex Candidate") is partly a **parking heuristic** (`parkingCalculator.ts:53`: surplus parking ≥2 AND Detached), not a structural-suite read — defensible-ish but soft.

### 4. Builder / Developer — **HOLLOW. The promised moat does not exist.**
- **Magic moment (promised in CLAUDE.md §2):** PostGIS zoning overlays, price-per-*buildable*-sqft, "this lot is multiplex-by-right under the new zoning." That's a six-figure-decision tool.
- **What's actually shipped (`src/services/BuilderAnalyticsEngine.js`):**
  - `zoningDesignation = rawJson.Zoning` — raw TRREB free-text, sparsely populated, **no parsing, no bylaw lookup** (`:106`).
  - `multiplexByRight = false` **hardcoded**, comment says "Calculated separately based on zoning" — that calculation **never happens** (`:108`). `aduEligible`/`gardenSuiteEligible` also hardcoded `false`.
  - `severance_candidate` / `density_play` = crude lot-width thresholds (≥80ft → "MEDIUM"), **no municipal zoning** (`:53-63`).
  - `price_per_sqft` = ListPrice ÷ LivingAreaRange midpoint = price per *existing finished* sqft, **NOT price-per-buildable-sqft** (`:69-78`). The headline builder metric is mislabeled.
  - `is_density_ready` (terminal filter) = the parking heuristic again.
- **Verdict:** A developer would spot this as fake in 60 seconds and never return. **This persona must be cut from the launch story** until real zoning data is ingested (a months-long municipal-data project, not a sprint).

---

## RECOMMENDED BEACHHEAD: the **Cashflow Investor** (with the Flipper as fast-follow)

Reasoning the council must pressure-test:
1. **The one truly defensible, finished magic moment already serves them** — the Underwriting Sandbox. We are *closest to done* here; we just have to push the magic from the detail page out to the map/list.
2. **It's the sharpest, most underserved wedge vs HouseSigma.** HouseSigma gives sold prices + an AI estimate to *everyone* (mostly homebuyers). Nobody gives the small-portfolio Canadian landlord a **map that re-colors by *their own* cash-on-cash** the instant they set leverage. That is a feature HouseSigma structurally won't build — it would alienate their realtor-referral business model.
3. **They have money and acute pain.** A cashflow investor evaluating 40 doors/month will pay for a tool that saves them building 40 spreadsheets. That funds everything else.
4. **Builder is hollow** (above) and **Smart Homebuyer is HouseSigma's home turf** (they have 1M+ users there; a frontal assault loses). Cashflow is the gap *we can credibly own first*.

Not "serve all four." **Be the terminal a Canadian cashflow investor opens every morning.** Earn the obsession of 500 of them, then expand.

---

## My 3 boldest moves

### Move 1 — "Underwrite the whole map." Push the Sandbox's leverage assumptions UP into the terminal as global state.
- **Persona:** Cashflow Investor (beachhead).
- **What:** A persistent top-bar control — *My down payment %, My rate, My rent assumption* — that feeds a **deterministic per-listing cash-on-cash** computed in the ETL (`computeUnderwriting` already exists; run it at index time against a rent model, store `coc_at_20pct`, `cashflow_at_20pct` as *real* populated Typesense fields). Then the map re-colors and the list re-sorts by **the investor's own return**, live.
- **Why it beats HouseSigma:** They show one generic "estimate." We show *your* deal economics across every active listing in <50ms. This is the magic moment, finally at the funnel top — and it converts the dead `gross_yield_est`/`cashflow` fields from empty to the product's spine.
- **Compliance note for `compliance`:** all deterministic, no LLM, no raw-data transform — should be SAFE, but flag the rent-model provenance.

### Move 2 — "The Distress Wire." A standing, push-alert deal feed (not a re-run filter) for Flippers.
- **Persona:** Flipper / Deal Hunter (fast-follow).
- **What:** Let a user save a *query* (e.g. "Peel, detached, <$900k, True DOM > 90, any price drop") and get a real-time/daily alert the instant a listing crosses it — reusing the existing alerts pipeline (`scripts/worker/alerts.ts`) but keyed on a saved *search*, not a saved *listing*. Lead with our True DOM (defeats the relist-reset) as the headline signal.
- **Why it beats HouseSigma:** HouseSigma alerts you about saved homes; nobody alerts a flipper the *minute* a motivated seller appears anywhere in their buy-box, with relist-corrected DOM. This is the flipper's actual job-to-be-done.

### Move 3 — Reframe the Smart Homebuyer surface as **"Your real monthly cost"**, and CUT the Builder persona from the launch.
- **Persona:** Smart Homebuyer (reframe) + Builder (kill until real).
- **What:** On suite-candidate listings, lead with one number a homebuyer actually wants — *"Real cost with a basement tenant: $1,400/mo"* — derived from the existing suite flag + rent estimate + Sandbox, in plain English (no DSCR). Simultaneously, **remove Builder from the persona switcher / onboarding** (`personaConfig.ts:316`, apply objective "Land assembly / development") until `multiplexByRight`/zoning is real, because shipping a visibly-fake developer tool poisons credibility with the exact analytical audience we court.
- **Why it beats HouseSigma:** HouseSigma never translates "basement = lower true cost" for a buyer; and *not* shipping a hollow feature is itself a quality-bar win (CLAUDE.md §10: equivalent/hollow ≠ ship).

---

## The biggest thing I will challenge another camp on
I expect `data-quant` and/or `growth` to defend the **Builder persona** and/or a **public AVM** as a leapfrog/SEO play. I will argue: (a) Builder is *hollow today* (`BuilderAnalyticsEngine.js` evidence above) and serving a fake tool to developers is worse than not serving them; and (b) we are **fatally unfocused** — four half-built personas instead of one obsession-worthy one. I'll push the whole council to ruthlessly de-scope to the Cashflow beachhead for launch.
