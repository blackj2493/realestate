# PureProperty.ca — Consensus Strategy to Beat HouseSigma
### "Open the lobby, gate the vault — and lead with the wedge"

*Produced 2026-06-04 by a 7-agent strategy council (Product/UX · Data/Quant · Perf/Arch · Competitive · Growth · Persona · Compliance), debated over 3 adversarial rounds to consensus. Round-by-round transcripts in `docs/strategy/beat-housesigma/`.*

---

## TL;DR (the answer)

Stop trying to out-feature HouseSigma and start exposing what its business model **forbids it from showing.** HouseSigma's free data is a lead funnel for its in-house 1.5% brokerage — so it's structurally incentivized to *obscure* the tools that let investors act without an agent. PureProperty has **no brokerage to protect**, and a TRREB VOW licence whose derivative-analytics clause *requires* gating behind an account. That turns a compliance obligation into the growth wedge:

> **Open the licensed active-listing terminal to anonymous users (low friction); put the real edge — relist-corrected True DOM, condition-aware AVM, full sold comps — behind the account the VOW already mandates; and tease the vault with safe aggregates HouseSigma's bland "sign up to see the sold price" gate can't match.**

Win the **Flipper/Deal-Hunter first** (the one persona whose magic moment runs on real, populated data *today*), make the **Cashflow Investor the destination** (unlocks when a rent model lights up the already-built financial engine), and **cut the Builder persona** (it's hollow). But none of it matters until **production is stabilized and the fake numbers are killed** — both shipping in week one.

---

## 1. The brutal truth about current state (grounded in code + live prod)

The council audited the real repo and live backends. Three findings reframe everything:

1. **Production is down right now.** Typesense returned **502 on ~10 consecutive calls** this session — a sustained outage, not a cold start. The terminal queries Typesense directly from the browser (genuinely good, low-latency architecture), but *"a sub-50ms design that 502s = 0ms of value."* **Stabilize is Task #0** — and re-indexing into a 502 cluster risks data loss, so triage is a hard blocker.

2. **The cashflow edge is vapor.** The tables feeding `cap_rate_est` / `gross_yield_est` / `cashflow` (`rental_market_index`, `city_region_avg_price`, `municipal_mill_rates`) **all return 404 — they don't exist.** The one populated field, `ExtrapolatedCapRate`, is **fake**: a static **$5,500/mo rent for every property** = `f(ListPrice)` cosplaying as yield. The most numerate persona (cashflow) would catch this on listing #1 and never return. *Crucially:* `financialMetrics.ts` is already written and wired — it returns 0 only because `has_data:false`. **The fix is data, not engine code.**

3. **There is one real, defensible moat.** The hedonic **AVM** (`avm_multiplier_matrix` = 7,760 coefficients, 969 cohorts all n≥30, engine-on for 479) + **214,516 real sold-price chains** (`property_sale_history`). True DOM, relist chains, price compression and Capital Burn are all computed off this real base.

**Other verified liabilities:** the listing page is `force-dynamic` with an uncached `select("*")` JSONB detoast + a **live external `/PropertyRooms` call** recomputed per visitor/crawler (`[id]/page.tsx:36`, `getListingDetail.ts:182-216`) — the #1 SEO + scale bomb. The terminal has **zero mobile layout** (`page.tsx:272` hard side-by-side; resize is mouse-only). The watchlist save-heart (`LedgerRow.tsx:107,159`) and drawer Add/Schedule buttons (`ListingTerminal.tsx:527-532`) are **dead no-ops** — a "prototype" tell to a skeptical analyst. The map renders only the 100 clickable pins (`AlphaMap.tsx:262`), so dense cities silently truncate and look *emptier* than HouseSigma.

---

## 2. Why this beats HouseSigma & Realtor.ca

| | HouseSigma | Realtor.ca | **PureProperty (the wedge)** |
|---|---|---|---|
| **Real business** | In-house 1.5% brokerage; data = lead funnel | Listing portal (CREA) | Pure analytics; no brokerage conflict |
| **Structural blind spot** | Must obscure tools that kill the agent hand-off | Data-starved: **no sold, no estimate** | Exposes self-serve underwriting they can't |
| **Estimate** | AI estimate **admits it can't tell renovated from gut** | None | **Condition-aware, glass-box AVM** ("why this number") |
| **Distress signal** | Half-shows DOM; cancel-and-relist defeats it | None | **Relist-corrected True DOM** across stitched chains |
| **Free-tier gate** | Bland "sign up to see the sold price" | ~84% category reach, shallow | **Aggregate-VOW teaser** ("7 sold firm/30d · median True-DOM 41d · 3 under ask") |

The two launch wedges — **relist-corrected True DOM** (the seller's real desperation) and the **reno-vs-gut AVM truth** — are precisely what HouseSigma's incentive structure forbids it from building, and they sit gated exactly where the VOW licence already requires.

---

## 3. The compliance envelope (the box every move lives in)

Verified against both signed TRREB agreement PDFs. **Breaking these risks API revocation.**

- **The bright-line test:** *Does the number require joining records the feed didn't already join for us?* If yes → **gate or aggregate**.
- **ANON-SAFE (public):** a single active listing's own IDX fields + display-computations on them — list price, beds/baths/sqft, brokerage, verbatim remarks, carrying cost, and **this listing's own price-drop** (`PreviousListPrice − ListPrice`; arithmetic on one record's own fields, §6.3(f) permits, §6.2(f) not triggered — already computed at `transformer.ts:596-597`).
- **GATED (behind account, `requireConsumer`):** anything that stitches the dataset or uses VOW sold — **True DOM, relist-chain price drop, Capital Burn, AVM, sold comps** (True DOM folds in `raw_vow_sold`; verified `sync.ts:116-125,395`). Legal only via VOW §6.2(f), which requires it be **both** password-gated **and** for providing brokerage services.
- **PUBLIC AGGREGATES OK:** count-only / distribution shapes escape the 100-display cap (count ≠ listing, §6.3(b)); **sold/VOW aggregates need min-N ≥ 5** cell suppression; thin public yield cells need **min-N ≥ 8**.
- **FORBIDDEN:** a public/logged-out "what's your home worth" AVM (§6.2(f) + Purpose §3.2); passing raw IDX/VOW data through any LLM (§6.2(k) — ETL is currently clean); exporting gated AVM/sold numbers outside the gate.
- **Hard preconditions:** (a) flip **`VOW_ENFORCE_TERMS=true`** before any new gated surface ("cheapest win on the board"); (b) **brokerage display on every surface** (§6.3(c)) — map popup & ledger verified clean (shared `ListingCardBody`), but the **public compare table is a CONFIRMED breach**: `CompareClient.tsx:85-100` renders its own table with price + address only (no `ListOfficeName`; the brokerage row declared in `compareMetricsConfig.ts` is *not* among the rendered `CORE_METRICS`). Fix = add a sibling-weight brokerage row to `CompareClient.tsx` **and verify `CompareMobile`** — must land before F sends anon traffic to `/properties/compare?ids=...`.
- **Process gate:** any new public URL/subdomain needs **Broker-of-Record pre-approval** (Katherine Milian, EXP Realty) filed with PROPTX (§6.3(g)) — a sign-off step, not a deploy.

---

## 4. The prioritized roadmap

Effort: **S** ≤2 days · **M** 3-5 days · **L** 1-2 weeks. Each move tagged with persona + compliance grade.

### 🩹 PHASE 0 — Stabilize & stop the bleeding (≈1 week, ships as ONE release)
| ID | Move | Effort | Notes |
|---|---|---|---|
| **A** | **Stabilize prod** — triage Typesense 502 + health-alerting + Supabase circuit-breaker | M (triage ≤1d) | TRUE BLOCKER; re-index into 502 = data loss |
| **B** | **Kill fake numbers + flip default** — retire `ExtrapolatedCapRate` (keep honest `capital_burn_rate`); default first-run persona `smart`→`flippers` (`store:226`) | S (~1 file) | **Ships in same release as A** (redline). Makes the public first impression real-only |
| **C** | **Compliance preconditions** — (1) `VOW_ENFORCE_TERMS=true`; (2) confirm brokerage-clean surfaces; (3) **fix confirmed §6.3(c) breach** — add brokerage row to `CompareClient.tsx` (+ verify `CompareMobile`) | S-M | Precondition for ALL gated surfaces; the compare fix must precede F |

### 🔧 PHASE 1 — De-fake & cache the foundation
| ID | Move | Effort | Notes |
|---|---|---|---|
| **D1** | **Rent model** — build the 3 missing feeder tables; emit two columns: `rent_idx_public` (IDX-only → public yield, min-N≥8) + `rent_blended_gated` (VOW → gated) | M | **Zero new engine code** — lights up wired `financialMetrics.ts`. Unlocks Cashflow + SEO-yield + H |
| **D2** | **Trust-spine** — wire the dead watchlist heart + drawer buttons to the real store | S | **Flipper-launch blocker** (dead heart = "prototype") |
| **E1** | **Listing-page ISR/cache** + named-column select (auth-partitioned: IDX cached, VOW rail per-request) | S-M | ~80% of the SEO+scale win; **gates F**. [E2 rooms→ETL = later] |

### 🚀 PHASE 2 — The wedge & the funnel (the "instant hit")
| ID | Move | Effort | Notes |
|---|---|---|---|
| **F** | **Open the lobby, gate the vault** — anonymous-first public active terminal; **first tap = persona-pick** that reshapes the view | M | Dependency chain: **B + E1 + M(minimal)**. Bundled with G (persona-pick is lipstick unless it reshapes substance) |
| **G** | **The Flipper distress wedge** — gated row-level True DOM/relist/Capital-Burn + **public aggregate teaser** ("7 sold firm/30d · median True-DOM 41d · 3 under ask", min-N≥5) + the safe single-listing price-drop number on the anon card | S-M | Real data today. **LEAD ALL MESSAGING HERE** |
| **M** | **Responsive Map/List toggle** (minimal) | S | Elevated to **P0 growth-gate** — mobile is the denominator on every channel |

### 📈 PHASE 3 — Differentiate, distribute, destination
| ID | Move | Effort | Notes |
|---|---|---|---|
| **H** | **"Underwrite the whole map"** — per-listing real cash-on-cash at index time; map recolors by *your* return | M | Gated. **Hard downstream of D1.** The Cashflow destination magic moment (4-agent convergence) |
| **I** | **Glass-box condition-aware AVM** — per-feature breakdown + sold-price timeline (full gated / aggregate teaser public) | M | The reno-vs-gut truth HS concedes it lacks |
| **J** | **Uncapped count-only heat layer** beneath the ≤100 pins (active public / sold gated, min-N≥5) | M | The **permanent** answer to ">100 results" — no infinite-scroll workaround (§6.3(b)) |
| **K** | **Share/referral loop** — double-sided invite codes (Safe, zero data dep) + active-only Deal-Card OG exports | S | Cheap + safe → **can run Phase-1-parallel** |
| **L** | **Investor-Lens SEO** — batched aggregate-ETL for honest distress/inventory pages (count, %price-cut, months-of-supply) now; yield pages after D1; templated prose, no LLM | M | `region_aggregates` is an RPC not a table; build a bounded aggregate-ETL |

---

## 5. The launch funnel & messaging

**The 3-layer teaser** (co-authored by Competitive + Growth, compliance-vetted):
- **Layer 1 (public): passthrough facts** — address, price, specs, brokerage, freshness, single-listing price-drop. *Table stakes — earns the click.*
- **Layer 2 (public): aggregate-VOW teaser** — velocity, relist-corrected True-DOM median, under-ask rate (min-N≥5, server-side, never rows). ***THE wedge — earns the signup.*** Out-teases HouseSigma's blank gate with insight shapes it won't build.
- **Layer 3 (gated): the moat** — per-listing True DOM + relist chain, glass-box AVM, sold comps, Value-Add. *The application proves bona-fide interest AND is the unlock — earns the daily habit.*

**Locked funnel sequence:** B (kill fake + flipper default) → flip homepage to public terminal (F) → invite loop (K) in parallel → unlock Cashflow only after D1 → open paid/organic traffic taps only after E1 (ISR) + M (mobile). VOW gate constant throughout.

**Messaging discipline (Competitive + Persona emphasis):** lead with the **wedge** — *"see which sellers are bleeding, and which renos actually paid"* — never the plumbing (*"we opened the terminal"*).

---

## 6. Beachhead decision

- **Launch persona = Flipper / Deal-Hunter.** Runs on real, populated data *today* (True DOM, price drops, 214k sold chains). `flippers` persona config already sorts/colors by real fields (`personaConfig.ts:303-312`).
- **Destination persona = Cashflow Investor.** Unlocks the day D1 ships. (`cashflow` config currently keys on the *fake* `ExtrapolatedCapRate`, `personaConfig.ts:272-281` — must not be the default until de-faked.) *Flipper and Cashflow are often the same human at different moments — we enter through the door that works today.*
- **CUT: Builder/Developer.** Hollow — no PostGIS zoning exists, `multiplexByRight` hardcoded `false`, price-per-sqft is existing-finished not buildable. Two real personas beat four half-built ones.

---

## 7. Logged dissents & guardrails (consensus is real, not forced)

- **`product-ux` (dissent):** do **not** ship F before M(minimal) responsive toggle — *"don't open a door you've made unwalkable for the visitors you invited."*
- **`perf-arch` (dissent):** the heat layer (J) must be the **permanent** answer to ">100 results" — explicitly forbid any future infinite-scroll workaround (§6.3(b)).
- **`data-quant` (redline):** B (kill fake number) ships in the **same release as A** — never let the fake cap rate face one more user.
- **`growth` (soft):** mobile (M) is under-weighted as fast-follow; tripwire logged.
- **`competitive` (emphasis):** launch messaging leads with the wedge (G), not the funnel (F).

---

## 8. The one-sentence strategy

**Be the analytics terminal HouseSigma's brokerage can't afford to build and Realtor.ca has no data to build — by opening the licensed lobby for free, gating the real edge exactly where the VOW already requires, and teasing that vault with aggregates nobody else will show.**

---

*Council roster & full transcripts: `docs/strategy/beat-housesigma/` (R0 openings · R1 cross-examination · R2 reconciliation ballot + rankings · R3 sign-offs).*
