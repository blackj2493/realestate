# R2 — Compliance / TRREB Guardrail (reconciliation)

**Author:** `compliance` | **Round:** 2 | Read R2-BALLOT + all R1s. I verified the True-DOM data path in code before ruling (it changes move G). Phasing endorsed with one re-scope. Risk grade on every A–M; ranked top-5 by impact-within-the-envelope.

---

## OPEN QUESTION #1 — the bright-line anon-teaser list (my decisive call)

**The principle (one line):** A logged-out user may see **the IDX feed's own fields for a single active listing, plus display-computations on that one listing's own fields.** Everything that *stitches the dataset together into a new analytic* — across listings, or across a property's sale history — is either an IDX-derivative (no carve-out) or a VOW-derivative (gate-mandatory). **The test is not "is it a number" — it's "does the number require joining records the feed didn't already join for us?"**

### ✅ ANON-SAFE — a logged-out user MAY see these on an active listing
*(all are raw IDX fields or a computation on a single listing's own raw fields; IDX §3.2 Purpose licenses active display; §6.3(f) permits field-selection display)*
- **List price** (`ListPrice`) — raw IDX field. SAFE.
- **The listing's own status & dates as fed** — `StandardStatus`, `OriginalEntryTimestamp`, `DaysOnMarket` **as carried in this single active listing record** (the feed's own per-listing day count, not our stitched number). SAFE.
- **A price-drop FACT *within this one active listing record*** — i.e. the change between this listing's own `OriginalListPrice`/`PreviousListPrice` and current `ListPrice`, when the feed itself carries both on the record. This is displaying a feed field, not computing across listings. SAFE. **CAVEAT below.**
- **Structural facts** — beds, baths, sqft-range (labelled est.), lot, parking, property type, address, **brokerage (mandatory, §6.3(c))**, public remarks *as fed, verbatim* (no LLM rewrite — §6.2(k)).
- **Single-listing display computations** — carrying cost (list price + tax + a stated rate assumption), cap-rate-on-LIST with a *static or user-supplied* rent (clearly labelled "on list price"). These compute from this one listing's own fields + a user/constant input; no dataset join. SAFE. *(If the rent input is VOW-leased-derived, it crosses to gate-only — see data-quant note.)*

### 🔒 GATE-REQUIRED — a logged-out user may NOT see these (aggregate-teaser only)
*(each STITCHES the dataset or VOW sold data into a new analytic)*
- **True DOM / total price-drop across the relist chain / is_stale / Capital Burn Rate.** **THIS IS THE BIG CORRECTION (see move G).** I verified in `sync.ts:116-125,395,410`: True DOM's chain is built from **`property_sale_history`, which is re-keyed from `raw_vow_sold`** — *"PLUS prior sold campaigns (raw_vow_sold), merged into one chain."* So **True DOM folds in VOW sold/closed records → it is VOW-derived → §6.2(f) → GATE-ONLY.** It is NOT an active-listing fact. A public True-DOM badge is a breach.
- **AVM estimate, Value-Add upside, the per-feature breakdown, sold-price timeline** — VOW sold derivatives (§6.2(f)).
- **Sold prices / dates / sold comps / sold media** — raw VOW Listing Information (§3.2 Purpose, password-protected).
- **Cross-listing active analytics** — "cheaper than 80% of the neighbourhood," neighbourhood rank, "best value on this street." Even though built from *active* data, these are *derivative analytical tools* over the IDX dataset, and **IDX §6.2(f) has NO carve-out** (R0 §1 #2). → keep as an **aggregate/heat cell** (Ruling 1 / move J) or gate.

### The CAVEAT that makes the bright line safe to operate
For the "price-drop fact" and "DaysOnMarket" anon-safe items: they are SAFE **only when shown as the feed's own per-record value.** The instant the displayed number is *our stitched cross-listing value* (the relist-corrected True DOM, the chain price drop), it's VOW-derived and gated. **Product must source the anon badge from the single listing record, not from the `true_dom`/`total_price_drop` fields.** This is a real, easy-to-trip wire: the same visual "−$25k, 96 days" badge is SAFE if it's this-listing-only and FORBIDDEN if it's the stitched chain. Label and source accordingly.

**Net answer to the council:** the anon teaser leads with **active listings + single-listing facts/computations + an AGGREGATE distress teaser** ("7 sold firm here in 30d, median True-DOM 41d, 3 under ask" — counts/medians, server-side, min-N≥5). The *row-level* True-DOM/distress magic unlocks behind the gate. This is `compliance` R0 Move 1 = `growth` R1 Move 1 = `competitive` R1 endorsement — already converged.

---

## THE ROUTED RULING — single-listing `OriginalListPrice − ListPrice`: passthrough or §6.2(f)?

**Question (from growth + competitive, via lead):** Displaying the subtraction of two active-feed-native fields on ONE listing — does the *arithmetic* trip IDX §6.2(f) (→ price-compression is gate-only), or is it public passthrough? This decides whether the public hook can show a price-drop *number*.

**VERDICT: ✅ SAFE — PUBLIC PASSTHROUGH (display computation). The arithmetic does NOT trigger IDX §6.2(f).** A single-listing price-drop number may appear on the anonymous/public hook.

**The reasoning, clause by clause:**
1. **What §6.2(f) actually prohibits.** IDX §6.2(f) bars: *"distribute, redistribute, copy... alter, modify... the IDX System or any part thereof, **or merge IDX Data... with other data or any AI System**, or publish IDX Data... or **in any other way exploit any such data.**"* The target of this clause is **repackaging/merging/exploiting the DATASET** — it is the anti-scraping, anti-data-product, anti-merge clause. Subtracting two fields **of the same single listing record** merges nothing with other data, copies/redistributes nothing, and creates no dataset-level derivative. It is a presentation of two values the feed already carries on that one record.
2. **What §6.3(f) affirmatively ALLOWS.** §6.3(f): content may be *"reformatted... to the extent of choosing which fields to display."* Displaying `OriginalListPrice`, `ListPrice`, AND their difference is field-selection display plus a trivial presentational computation — it does not *change the feed's content* (both source fields remain accurate and shown); it adds a derived view of this record's own data. The agreement permits showing the fields; showing the gap between two of them is the same category of act.
3. **The bright-line test from OQ#1 confirms it.** My test: *"does the number require joining records the feed didn't already join for us?"* Answer here: **No.** Both operands live on the single active listing record. No cross-listing join, no `raw_vow_sold`, no `property_sale_history`. It is the textbook "single-listing display computation" already on my ANON-SAFE list (alongside carrying cost and cap-rate-on-list).
4. **Grounded in our own code.** The deterministic ETL already computes exactly this on active records: `transformer.ts:596-597` — `(raw.PreviousListPrice - raw.ListPrice) / raw.PreviousListPrice * 100` — feeding the active per-listing reduction flag. It is §4-clean (no LLM) and uses only that listing's own fed fields. This is categorically DIFFERENT from `total_price_drop` / `true_price_drop_pct` (TemporalDistressEngine), which stitch the **chain** across `raw_vow_sold` and ARE VOW-derived → gated.

**Two conditions (so the SAFE call stays SAFE):**
- **(a) Source field provenance.** The operands must be **active-feed-native on the active record** — `ListPrice` + the listing's own `OriginalListPrice`/`PreviousListPrice` as carried in the *active IDX feed*. Per the payload specs, `ListPrice`/`PreviousListPrice` are IDX-feed fields; `OriginalListPrice` is listed under the VOW spec, so **before shipping `OriginalListPrice` specifically on a public surface, confirm the ACTIVE IDX record carries it** (data-quant/perf-arch to verify the field is populated from the IDX feed, not back-filled from VOW). If the only available "original price" is VOW-sourced, that variant is gated; the IDX-native `PreviousListPrice→ListPrice` drop is unambiguously SAFE today.
- **(b) Single-listing only, never the chain.** This SAFE ruling covers the **drop within ONE active listing record**. It does NOT cover the relist-stitched chain drop (`total_price_drop`) — that's VOW-derived and gated (move G). Same visual "−$25k"; the SAFE one is this-record arithmetic, the GATED one is the stitched chain. Product must wire the public badge to the single-record fields, not to `total_price_drop`.

**So: the public hook CAN show a price-drop number** — the active listing's own `(OriginalListPrice/PreviousListPrice) − ListPrice`, with brokerage (§6.3(c)) and the §6.3(i)/(k) notices present. The relist-corrected True-DOM/chain version stays gated (with an aggregate teaser).

---

## Risk grade on every ballot move (Safe / Gated / Forbidden + condition)

| | Move | Grade | Clause / condition |
|---|---|---|---|
| **A** | Stabilize prod (Typesense 502, health alerting, circuit-breaker) | ✅ **SAFE** | No data-display change. Also a *compliance* asset: §6.3(h) 24h-freshness + the silent-cursor-advance failure mode mean a dead sync can serve stale/missing data; health alerting protects the freshness obligation. |
| **B** | Kill fake numbers (`ExtrapolatedCapRate` + empty cap/yield → "—") | ✅ **SAFE** | Removing a display never breaches. *Affirmative compliance value:* a fabricated cap rate shown as "institutional data" risks a §5.8/§10.1 data-integrity/"deemed reliable" problem and reputational §6.2(q) exposure. Showing "—" is strictly safer. |
| **C** | Flip `VOW_ENFORCE_TERMS=true` + audit brokerage display | ✅ **SAFE** (it IS the compliance fix) | §3.2 Purpose + §6.3(k) (terms gate the bona-fide-consumer wall); §6.3(c) (brokerage). **This is a precondition, not an option — see ranking.** |
| **D** | Real rent model (VOW-leased + IDX-lease) → light up yield/cashflow + fix watchlist spine | 🔒 **GATED output** | Engine is §4-clean (deterministic). **Sourcing line:** yield built on **VOW-leased** rent = VOW-derived → gated terminal only; if you want a yield number on any **public** surface, derive rent from **IDX for-rent only** (data-quant note). Watchlist-spine fix = SAFE. |
| **E** | Listing-page ISR/cache + rooms→ETL | ✅ **SAFE** *(1 hard condition)* | Cache the **IDX body only**; VOW-gated fields (AVM, sold history, breakdown) must **never** be baked into shared ISR/CDN HTML — compute per-auth behind `requireConsumer`, or you serve a VOW derivative to a crawler (§6.2(f)). Auth-partition the cache. |
| **F** | Open the lobby, gate the vault (public active terminal, first-tap persona) | ✅ **SAFE** *(4 conditions)* | §3.2 Purpose. Conditions: ≤100/query (§6.3(b)); brokerage on **every** anon surface incl. map popup (§6.3(c)); §6.3(i)+(k) notices render for anon; no cross-listing active *analytic* leaks (keep aggregate/gated). Already shipped architecture. |
| **G** | Flipper launch wedge — True DOM + price-drop + Capital Burn badge | 🔒 **GATED** *(RE-SCORE — ballot says/implies public; it CANNOT be)* | **True DOM is VOW-derived** (`sync.ts:395`, folds `raw_vow_sold`). The full row-level badge is **gate-only** (§6.2(f)). Compliant launch shape: **gated** badge for signed-in users + **public aggregate distress teaser** (counts/medians, min-N≥5). The wedge survives — it just lives behind the rope with an aggregate public hook, exactly like the sold teaser. **This is the one move whose compliant version differs from the ballot.** |
| **H** | Underwrite the whole map (per-listing real cash-on-cash, recolor) | 🔒 **GATED** | Depends on D's VOW-leased rent → VOW-derived → gated terminal. Deterministic/§4-clean. Map-recolor by *user's own* inputs is fine **behind the gate**; not a public surface. |
| **I** | Glass-box condition-aware AVM (breakdown + sold timeline) | 🔒 **GATED** (full) / ✅ **SAFE** (non-numeric teaser) | Full breakdown + timeline = VOW sold derivative, behind `requireConsumer` (§6.2(f)). Public = capability claim, **no numbers**. Keep deterministic — never route the breakdown through an LLM "explainer" (§6.2(k)). |
| **J** | Uncapped count-only aggregate heat layer | ✅ **SAFE** (active, public) / 🔒 **GATED** (sold) | Ruling 1 (pinned w/ perf-arch): public = active count + **mean-of-RAW-field**, k≥5 fixed grid, rows never shipped; gated = sold means + mean-of-derived-analytic. |
| **K** | Share/referral loop (invite codes + active-deterministic Deal Card OG) | ✅ **SAFE** *(AVM/sold/True-DOM stripped)* | Invite mechanics = out-of-scope (account provisioning). Deal Card export = **active-IDX single-listing facts + brokerage ONLY**; AVM/sold/upside/**True-DOM** numbers FORBIDDEN to export (§6.2(f),(r),(s)). Confirmed w/ growth. |
| **L** | Investor-Lens programmatic SEO + weekly report | ✅ **SAFE** *(5 conditions; currently blocked by data)* | Active-IDX aggregates ONLY, zero VOW columns; templated prose, **no LLM** (§6.2(k)); brokerage + §6.3(i)/(k) notices on any page surfacing an active listing. `region_aggregates` must be confirmed VOW-free before any column goes public (data-quant). |
| **M** | Mobile responsive floor | ✅ **SAFE** | No data-rule impact. Note: the §6.3(c) brokerage + §6.3(i)/(k) notice obligations apply on mobile cards too — don't let the responsive card drop them. |

**Forbidden, for the record (not on the ballot, but watch for them creeping in):** public AVM/valuation tool; any listing text through an LLM; exporting/syndicating VOW derivatives off-platform; >100 listings per query; a user-resizable sold "draw" that collapses to ~1 record.

---

## Phasing — ENDORSED, with one correction

A→B→C / D+E / F+G+H / then diff & distribution is right. **Two amendments:**
1. **G is GATED, not public.** Re-label it in Phase 2 as "gated Flipper wedge + public aggregate teaser." The phase order is fine; the *surface* is the correction.
2. **C is a hard precondition for Phases 2–3, not just a Phase-0 nicety.** No new GATED surface (G, H, I, the gated half of J, D's yield) may ship until `VOW_ENFORCE_TERMS=true` — otherwise a signed-in-but-not-terms-accepted user receives VOW derivatives without accepting the bona-fide-use terms the gate exists to enforce (§3.2, §6.3(k)). C unblocks the entire gated roadmap.

---

## My ranked top-5 (by impact achievable WITHIN the compliance envelope)

I rank by *compliant* impact — a high-impact move that's forbidden scores zero; a cheap move that *unlocks* everything else ranks high.

1. **C — Flip `VOW_ENFORCE_TERMS` + brokerage audit.** *(S effort, Safe.)* **#1 because it is the legal key to the whole gated roadmap AND closes two live breach vectors** (an unaudited missing brokerage on a map popup = citable §6.3(c) breach; un-enforced terms = VOW data to non-consented users). Nothing gated (G/H/I/J-sold/D-yield) is lawfully shippable until this is on. Cheapest, highest-leverage compliance action on the board. **Argue its rank up:** the council treats A/B/C as equal Phase-0 chores; C is not a chore — it is the precondition that converts "gated roadmap" from aspiration to lawful.
2. **F — Open the lobby, gate the vault.** *(M, Safe.)* The single highest-impact move that is *cleanly* inside the box — it's already the licensed shipped architecture, just surfaced. Turns the mandatory rope into the funnel. Zero new revocation risk if the 4 conditions hold.
3. **G (re-scoped) — Gated Flipper wedge + public aggregate distress teaser.** *(M, Gated + Safe teaser.)* Our sharpest real-data wedge (True DOM is populated TODAY) and HouseSigma structurally can't match it. High impact *behind the gate*; the aggregate teaser is the public hook. Ranks here because it's the launch differentiator that's real now — but only in its gated form.
4. **B — Kill fake numbers.** *(S, Safe.)* Punches above its effort: protects credibility with the exact analytical audience and removes a data-integrity/"deemed-reliable" exposure (§5.8/§10.1). A fake cap rate is a *compliance* risk, not just UX. Cheap, do it now.
5. **J — Aggregate heat layer (active public / sold gated).** *(M, Safe active / Gated sold.)* The HouseSigma-beating spatial view, and the *only* compliant way to "show more than 100" on the map (§6.3(b)). Pinned with perf-arch; ready to build on the safe tier today.

*(D/H are higher *product* impact but are GATED + data-blocked (rent model) + downstream of C — they're the Phase-2/3 payoff, not the within-envelope-shippable-now set. E and A I rank just below: both Safe, both unblock scale/SEO, E carries the one cache-partition condition.)*

---

## Moves whose COMPLIANT version differs from the ballot description (flagged, per lead)
- **G** — ballot frames it as a launch *badge*; the True-DOM number is **VOW-derived → gated**. Compliant = gated badge + public aggregate teaser. *(Verified `sync.ts:395`.)*
- **K** — ballot's Deal Card must additionally strip **True-DOM** (not just AVM/sold) from public/OG, since True DOM is VOW-derived.
- **L** — "region_aggregates" must be proven VOW-free column-by-column before public; some aggregates may be sold/leased-sourced and would be gate-only.
- **D** — a *public* yield number requires IDX-for-rent-only sourcing; the VOW-leased blend is gated-terminal-only.

---

## Concessions / holds
- **Conceded nothing I shouldn't** — but I *strengthen* `competitive`'s R1 catch: they flagged True DOM might be VOW-derived; I **confirm it in code** (`sync.ts:395`). Credit to competitive — this is the correction the whole council needed.
- **Hold (firm):** the gated/public line on True DOM and AVM is not negotiable for impact's sake. The aggregate-teaser pattern preserves ~all the growth value without crossing it, so there's no real impact loss to concede.
- **Endorse:** cut Builder (no lawful IDX analytics carve-out anyway), Flipper-first sequencing, "open lobby/gate vault," and the rent-model-as-critical-path consensus.
