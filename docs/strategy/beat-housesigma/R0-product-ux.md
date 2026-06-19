# R0 — product-ux (Product/UX Engineer)

Opening position. Grounded in the actual shipped code, not the BRIEF's map.

---

## What's genuinely good (don't touch / lean into)

- **The terminal core loop is strong.** `/properties` (`src/app/properties/page.tsx:271-335`) is a real 100vh map + ledger with a debounced (`page.tsx:244-251`) live re-query, parallel fan-out of comps + active layers (`page.tsx:210-215`), client-side column sort with no refetch (`LedgerPanel.tsx:46-49`), and map↔ledger hover sync (`hoveredId`, store `:300-301`). This is the Bloomberg feel the mission wants. TTV inside the terminal is good *once you're in it*.
- **The `UnderwritingSandbox` is the best thing in the app** (`src/components/Property/UnderwritingSandbox.tsx`). Live cashflow/cap/CoC/DSCR off a deterministic engine (`:97`), saveable named scenarios (`:110-118`) synced when signed-in / localStorage when not (`:354-358`). This already beats HouseSigma's static "mortgage calculator" — it's a real underwriting tool. **This should be the hero of the whole product, not buried in a 30% rail.**
- **Range histograms are real signal**, not decoration — full-population multi_search counts behind each slider (`RangeHistogram.tsx:18-23`), and they correctly *self-hide* when a field is empty (`:40`, e.g. the dead `gross_yield_est`). Honest UX.
- **Compliance UX is handled inline, not bolted on**: brokerage at sibling weight (`ListingCardBody.tsx:169-179`), the VOW reliability footer (`LedgerPanel.tsx:155-159`), the anonymous sold-teaser gate (`VowGateOverlay` via `page.tsx:303,321`).

---

## Key findings — the friction & dead-ends (with cites)

### 1. The terminal is desktop-only. There is NO mobile layout at all. (TTV killer at scale)
`src/app/properties/page.tsx:272` is a hard `flex h-screen` with `map flex-1` + a fixed-width ledger (`:319`, `ledgerWidth` 400–1000px). The resize handle is **mouse-events-only** (`startResize` `:119-137` — `mousedown/mousemove`, no touch/pointer events). A grep across the entire `CommandCenter/` dir for any responsive/mobile primitive (`md:hidden`, `isMobile`, `matchMedia`, `flex-col md:flex-row`, …) returns **zero matches**. On a phone you get a squeezed map jammed against an unreadable, un-resizable ledger. Real-estate browsing is ~60-70% mobile; HouseSigma's app is its #1 acquisition channel. We are structurally invisible on the device most high-intent investors check listings on (in bed, on a job site, between showings).

### 2. The listing detail "drawer" is a degraded clone of the full report, with dead CTAs.
Clicking any ledger row opens `ListingTerminal.tsx` (the 70/30 drawer). Its right-rail action buttons are **inert**:
- `ListingTerminal.tsx:527-529` "Schedule Viewing" → no `onClick`.
- `ListingTerminal.tsx:530-532` "Add to Watchlist" → no `onClick`, plain `<Button>`.

Meanwhile the **full** page `/properties/[id]/ListingActions.tsx:48-69` has a *working* watchlist toggle via `useWatchlistStore`. So the working component exists (`WatchButton.tsx`, `useWatchlist.ts`) — the most-used surface (the drawer, opened on every row click) just doesn't wire it up. A high-intent user clicks a deal, taps "Add to Watchlist," nothing happens, and they conclude the product is broken. Same dead "Schedule Viewing" on both surfaces (`ListingActions.tsx:40-46`).

### 3. The ledger "save" heart is fake — local state only.
`LedgerRow.tsx:107` `const [isSaved, setIsSaved] = useState(false)` and the heart toggle `:159-167` flips that local boolean. It does **not** call `useWatchlistStore`. Every saved heart silently evaporates on re-render/refilter. The one save action a scanning investor does most (heart-while-scrolling) persists nothing. (Real `WatchButton` should replace it.)

### 4. Dead code in the detail view signals "AI-touched listing text" risk and rot.
`ListingTerminal.tsx:63-87` `highlightNLPFlags()` builds a flags array, runs regex replaces… then **returns the original `text` unchanged** (`:86`). It's never even called. It's dead, but it's also a NLP-on-remarks shaped function sitting in the listing renderer — a compliance smell (§4: no IDX/VOW text through AI). Should be removed or replaced with the deterministic distress-flag highlighter it pretends to be.

### 5. Sqft is shown as a hard number when it's a bucket midpoint.
`ListingTerminal.tsx:336` renders `property.BuildingAreaTotal` as "Sqft" with no qualifier. Per the AVM memory, `building_area_total` is a `LivingAreaRange` bucket midpoint, not measured. Presenting it as a precise figure (e.g. "1,250 Sqft") to an analytical investor who will sanity-check it against the listing is a trust leak — HouseSigma at least labels ranges. Needs a "~/est." treatment or a tooltip.

### 6. Cold-start / first-run has no guided state.
A signed-in user is bounced to `/dashboard` (`page.tsx:22`); the *terminal* itself, entered with empty `location`, shows the LocationSearch placeholder "Search 83,051 Active Listings…" (`LocationSearch.tsx:148-152`) over a default map viewport. There's no "here's what to do first" affordance, no default high-signal view (e.g. "Top 20 deals near you by Deal Score"). The empty-results state (`LedgerPanel.tsx:130-137`) is a flat "No Assets Found / adjust your filters" — a dead end with no suggested next action (widen radius, clear a filter, try sold comps). High-intent ≠ wants-to-read-a-manual; the first 10 seconds must *show* the edge.

### 7. Persona switching silently rewrites the user's view with no explanation.
Changing persona resets the map mode (`page.tsx:149-151`), changes the ledger columns (`LedgerPanel.tsx:23`), and clears the column sort (`LedgerPanel.tsx:34-37`) — all at once, with no transition or "you're now seeing Flipper metrics" cue. For a first-timer the screen lurches and they don't know why. The persona selector is also tucked center-top and gated to residential-sale only (`TopCommandBar.tsx:57-64`) — easy to miss the single most differentiating control in the product.

---

## My 3 boldest UX moves

### MOVE 1 — Ship a real mobile terminal: "Pocket Terminal" (map-OR-list toggle + bottom-sheet underwriting).
**The single highest-leverage gap.** Replace the side-by-side desktop layout with a responsive split: below `lg`, render a full-bleed map with a draggable **bottom sheet** ledger (peek → half → full), a Map/List segmented toggle, and the `UnderwritingSandbox` as a swipe-up sheet on the listing view. Convert `startResize` to pointer events so it works on touch. 
*Persona:* all four, but acutely the **Flipper/Deal Hunter** who checks distress flags on the go between showings. 
*Beats HouseSigma:* their mobile app is a polished consumer browser; a *mobile underwriting terminal* (live cashflow on a phone) is something they structurally don't offer to investors. Equivalent desktop ≠ shippable when 60%+ of traffic never sees it.

### MOVE 2 — Make the Underwriting Sandbox the product's front door: a one-tap "Underwrite this" everywhere + a portfolio-wide scenario compare.
The sandbox already computes real numbers and saves scenarios (`UnderwritingSandbox.tsx:110`). Surface it: (a) an "Underwrite" action on every ledger row and map popup that opens the drawer *scrolled to the sandbox*; (b) a "Cashflow at X% down" live column the user can pin; (c) a saved-scenarios drawer that compares the same assumptions across all watchlisted properties side-by-side (the watchlist memory says *no sum aggregates* — this is per-property comparison, compliant). 
*Persona:* **Cashflow Investor** (maximize yield/ROI — this is literally their job). 
*Beats HouseSigma:* HS shows you a price estimate; we let you *underwrite the deal* and save/compare scenarios. That's the "shadow data → decision" jump no consumer portal makes.

### MOVE 3 — Fix the trust spine: wire every save/watch CTA to the real store, kill dead buttons, and add a first-run "Show me the edge" default view.
Three concrete, low-effort fixes that compound into "this product is real": (a) replace `LedgerRow`'s fake heart (`:107,159-167`) and the drawer's dead Watchlist/Schedule buttons (`ListingTerminal.tsx:527-532`) with the working `WatchButton`/`useWatchlistStore` already in the repo; remove dead `highlightNLPFlags`; label bucketed sqft as estimated. (b) On terminal entry with no location, auto-load a **"Top deals near you by Deal Score"** default ledger + map so TTV is *zero* and the edge is visible in second one. (c) Turn the empty-results state (`LedgerPanel.tsx:130-137`) into actionable nudges (widen radius / clear last filter / view sold comps). 
*Persona:* **Smart Homebuyer** (the least patient, most likely to bounce on a dead button or blank screen). 
*Beats HouseSigma:* HS's polish *is* its moat with retail users; if our interactions silently no-op we lose the one war we can't afford to lose — "does this thing even work?" Reliability is table stakes before any clever feature lands.

---

## The biggest thing I'll challenge another camp on (preview for R1)

I expect **data-quant** and **competitive** to push more *new* shadow-data engines (more metrics, more layers). I will challenge that hard: **we have more signal than we expose, and the surfaces that expose it are leaky (dead buttons, no mobile, bucket-sqft-as-truth).** Adding a 6th derived metric while the watchlist heart doesn't save is polishing the basement while the front door is broken. My R1 thesis: **the win is distribution of existing edge (mobile + reliability + Sandbox-as-front-door), not more edge.** Prove the new-metric ROI beats fixing the trust spine, or it waits.
