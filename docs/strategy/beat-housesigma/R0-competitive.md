# R0 — Competitive Analyst (HouseSigma & Realtor.ca teardown)

**Author:** `competitive` · Round 0 opening position
**Method:** WebSearch/WebFetch on live competitor behavior + spot-verification of PureProperty's shipped engines in `src/`.

---

## 1. The competitive landscape — hard numbers

| Platform | Canada RE rank | Monthly traffic | Sold prices | AI estimate | Investor metrics | Monetization |
|---|---|---|---|---|---|---|
| **Realtor.ca** | #1 (~84% of category visits) | tens of millions | **No** (private; opt-in by board, fragmented) | **No** | **No** | CREA-funded; member/agent ads |
| **HouseSigma** | #3 (~16% of category visits) | ~1.8M web / ~2M MAU app | **Yes** (account-gated) | **Yes** ("HouseSigma value") | rental yield + cashflow calc | **In-house brokerage** — 1.5% / 1% listing fee; data is the lead funnel |
| **PureProperty** | not ranked | pre-launch | Yes (VOW-gated) | Yes (hedonic ~11.4% MAE) | True DOM, cap rate, Value-Add, condo fee trend | TBD |

Sources at bottom. The strategic read: **Realtor.ca owns reach but is deliberately data-starved** (no sold, no estimate, sold prices only where a board opts in). **HouseSigma owns the data-savvy consumer**, and its real business is not data — it's a **lead-gen brokerage**: the free data exists to funnel users to its own 1.5%-commission agents. That funnel motive is the seam we attack.

---

## 2. Where they beat PureProperty TODAY (be honest)

1. **Distribution & trust.** HouseSigma has ~2M MAU and a 4.8–4.9 app rating; Realtor.ca is the default Canadian RE verb. We have zero. This is our #1 deficit and it's not a feature — it's a cold-start problem (hand to `growth`).
2. **Coverage breadth & national footprint.** HouseSigma spans multiple provinces; we're TRREB/GTA-centric. They also cover **rent + condo + freehold** uniformly with a mature mobile app. Our mobile story is unverified.
3. **A clean, finished, one-tap estimate.** HouseSigma's "click → estimate + comps" is frictionless for a mass audience. Our AVM is gated behind VOW + an "Application for Terminal Access" velvet rope. For *our* persona that's fine; but it means we never get the casual-to-serious conversion funnel they enjoy.
4. **Sold-history narrative is already their headline feature.** HouseSigma openly markets relisting/termination detection, multiple-price-reduction flags, and DOM storytelling ([homesfound.ca](https://www.homesfound.ca/blog/beyond-price-tag-what-housesigmas-listing-history-reveals-about-property/)). So "we show sold + price history" is **table stakes, not a wedge.** We must beat the *rigor* of their version, not just replicate it.

## 3. Where PureProperty already beats them — or structurally can

These are **verified in code**, not aspirational:

1. **True DOM that defeats the cancel-and-relist tactic.** HouseSigma *surfaces* relisting (it shows a new MLS number when an agent terminates + relists) but it still presents DOM per-listing — its own ecosystem calls raw DOM "a nearly useless statistic that is too easily gamed." Our `TemporalDistressEngine.ts:7-30` **stitches the chain into one campaign** with a 35-day window and emits a single `true_dom` + `total_price_drop` across the whole chain. That is a *computed, defensible* number HouseSigma shows the ingredients for but never bakes. **This is our single sharpest wedge.**
2. **Condition-aware valuation.** HouseSigma's own positioning admits its estimate **"cannot see the difference between a renovated house and a house in original condition"** ([homesfound.ca AI valuations](https://www.homesfound.ca/blog/demystifying-ai-home-valuations-how-housesigmas-ai-estimates-your-homes-worth/)). We ship `avm/conditionScoring.ts` + a **Value-Add / Force-Appreciation engine** (`avm/valueAdd/engine.ts`, `moveCatalog.ts`) that explicitly models reno ROI off hedonic coefficients. We can answer the exact question their estimate can't.
3. **Institutional "shadow" metrics HouseSigma doesn't compute at all:** `ExtrapolatedCapRateEngine`, `condo/feeStability.ts` (fee/sqft vs neighbourhood + same-corp fee trajectory — directly exposes the "special-assessment risk" buyers fear), `underwriting/useScenarios.ts` (interactive scenario underwriting), `dealScore`. HouseSigma gives a generic cashflow calc; we give an underwriting terminal.
4. **A persona-built product vs. a mass-market one.** HouseSigma must serve everyone because its funnel needs volume. That forces it to the *generic* middle. Our 4-persona filtering is a feature, not a bug — for the top 1% we can be denser and sharper precisely because we don't chase the casual buyer.

## 4. The strategic seam to exploit

HouseSigma's incentive is **lead capture for its 1.5% brokerage** — so it will never expose data that *helps you transact without an agent* or that *undercuts a listing it's trying to win*. PureProperty has no brokerage to protect. **Our entire positioning is "the data the brokerage is structurally incentivized to obscure."** Every move below leans into that.

---

## My 3 boldest moves

### MOVE 1 — Ship "True DOM + Capital Burn" as the signature listing badge, branded against HouseSigma's blind spot
- **What:** On every listing + comp card, lead with **True DOM** (stitched relist chain), total price drop across the chain, and **Capital Burn Rate** (carrying cost × true days = how much the seller is bleeding). One scannable line HouseSigma cannot reproduce because it presents DOM per-listing.
- **Persona:** Flipper / Deal Hunter (#2) — distress detection is their whole job.
- **Competitor gap:** HouseSigma admits raw DOM is gameable and shows relisting only as "a new MLS number"; it never collapses the chain into one true number. We make the gamed metric honest. *(Coordinate with `data-quant` on `true_dom` populated-ness; `compliance` to confirm derived-DOM display is clean.)*

### MOVE 2 — "Condition-adjusted value + Force-Appreciation" — beat the estimate they admit is blind
- **What:** Pair the AVM with a condition score and a ranked "what reno adds the most $ here" panel (already built in `valueAdd/`). Headline it explicitly: *"HouseSigma's estimate can't tell a renovated home from a gut job. Ours can."*
- **Persona:** Smart Homebuyer (#3) + Flipper (#2) — both need to know if a price reflects a reno or hides a project.
- **Competitor gap:** HouseSigma's marketing concedes this exact limitation. We turn their public admission into our headline. **Compliance flag:** VOW-derived AVM/Value-Add output is gated-use only — this must live behind the velvet rope / member gate, NOT as a public valuation tool (hand to `compliance`).

### MOVE 3 — "Cancel-the-agent" cashflow underwriting terminal as the wedge vs. their brokerage funnel
- **What:** Make the right-rail 70/30 underwriting calculator (cap rate, carry, downpayment, scenarios via `useScenarios.ts` + `feeStability` special-assessment risk) the thing a serious investor lives in — explicitly the analysis HouseSigma *won't* foreground because it routes you to an agent instead. Position: *"Underwrite the deal yourself. No agent funnel."*
- **Persona:** Cashflow Investor (#1) — yield/ROI is the entire decision.
- **Competitor gap:** HouseSigma's free tools are bait for its 1.5% commission brokerage; it has a structural incentive to keep self-serve analysis shallow. We have no brokerage, so we can go all-in on self-serve depth. **This is the durable moat: their business model forbids them from matching it.**

---

## The biggest thing I will challenge other camps on

I will push hard on anyone (likely `growth`) who wants to **lower the velvet rope / chase Realtor.ca-style mass reach.** That's a trap: we cannot out-distribute Realtor.ca or out-fund HouseSigma's brokerage funnel, and going mass forces us into the generic middle where HouseSigma already wins on coverage and trust. Our *only* winning lane is **density for the top 1%** — depth HouseSigma is structurally incentivized NOT to build. I'll also challenge any "ship a public AI estimate to win SEO" idea as a **compliance + strategy double-fault** (VOW revocation risk *and* it commoditizes us into a HouseSigma clone). I expect tension with `growth` on whether friction helps or kills the launch.

---

### Sources
- Traffic/rank: [Similarweb HouseSigma vs Realtor.ca](https://www.similarweb.com/website/housesigma.com/vs/realtor.ca/) · [Similarweb HouseSigma](https://www.similarweb.com/website/housesigma.com/)
- HouseSigma estimate + limits: [homesfound.ca AI valuations](https://www.homesfound.ca/blog/demystifying-ai-home-valuations-how-housesigmas-ai-estimates-your-homes-worth/) · [suesellsscarborough accuracy](https://suesellsscarborough.com/Blog/how-accurate-is-the-housesigma-app)
- Listing-history feature set: [homesfound.ca listing history](https://www.homesfound.ca/blog/beyond-price-tag-what-housesigmas-listing-history-reveals-about-property/) · DOM-gaming: [Toronto Realty Blog](https://torontorealtyblog.com/blog/days-on-market-dos-and-donts/)
- Monetization (1.5%/1% brokerage funnel): [bethandryan.ca](https://bethandryan.ca/a-realtors-role-not-just-sending-you-sold-prices-of-homes-2/) · [HouseSigma sell-with-us](https://housesigma.com/blog-en/five-great-reasons-why-you-should-sell-your-home-with-housesigma/)
- Realtor.ca sold-price limits: [Greater Vancouver sold on Realtor.ca](https://realestatemagazine.ca/sold-prices-for-listings-from-greater-vancouver-realtors-now-live-on-realtor-ca/) · [kentbraaten.com](https://www.kentbraaten.com/blog/sold-listings-realtorca-transparency/)
- PureProperty verified in code: `src/lib/typesense/TemporalDistressEngine.ts:7-30`, `src/lib/condo/feeStability.ts`, `src/lib/avm/conditionScoring.ts`, `src/lib/avm/valueAdd/engine.ts`, `src/lib/typesense/ExtrapolatedCapRateEngine.ts`, `src/lib/underwriting/useScenarios.ts`, `src/app/(app)/hidden-equity/page.tsx`
