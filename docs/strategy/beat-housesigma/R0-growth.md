# R0 — Growth / Go-To-Market opening position

**Author:** `growth`  ·  **Round:** 0 (opening)  ·  Read-only audit + GTM strategy.

---

## TL;DR

We are building a Bloomberg Terminal but selling it with a **velvet rope that has no rope physics behind it**, **zero referral loop**, and an **SEO engine that is 80% built and deliberately switched off at the door**. HouseSigma did not win on data sophistication — it won on **one viral wedge (free sold prices, first to market) + programmatic geographic SEO**, growing to **2M+ registered users and 5M monthly visits** ([HouseSigma About](https://housesigma.com/blog-en/about-us/)). We cannot out-HouseSigma HouseSigma on "free sold data" (compliance won't let us, and they're 7 years ahead). We win by being the **deal-flow utility investors check every morning** and by turning every analysis a user runs into a **shareable, indexable artifact**. The friction of the velvet rope is an asset *only if* it's paired with a referral loop that makes the rope a status object. Right now the rope just bleeds 80%+ of top-funnel traffic with nothing to recapture it.

---

## Key findings (grounded in code)

### 1. The funnel is a cliff, not a ramp — TTV is gated behind a 3-step form + auth wall
- Landing page (`src/app/page.tsx:58-67`) has **exactly one CTA**: "Apply for Terminal Access" → `/apply`. No "see a sample," no demo terminal, no teaser. A first-time high-intent investor arriving from a Google search or a forum link **cannot see a single number** without completing a 3-step application (`src/app/apply/page.tsx`) AND a magic-link sign-in (`handleSubmit` routes to `/login?next=/dashboard`, `apply/page.tsx:275`).
- The velvet-rope copy is genuinely good ("Built for principals, not practicing agents," `page.tsx:43`) and the application captures *excellent* intent data (`applicantType`, `objectives`, `regions`, `capital`, `assets` — `apply/page.tsx:244-253`) that seeds a persona dashboard. **This is a real asset.** But it's spent *before* the user has felt any value. Robinhood/Monzo/Clubhouse waitlists work because the user wants in *before* they sign — here we demand the form before they've seen the product is worth wanting.
- **The terminal `/properties` is already public and indexable** (`robots.ts:5-26` allows it; it's in the sitemap at priority 0.9). So the velvet rope is *inconsistently* applied: sold/VOW data is correctly gated (compliance), but the marketing homepage funnels everyone into the gate even though the active-listing terminal is open. **The homepage is hiding its own best free asset.**

### 2. There is a real SEO engine — and it's mostly turned off
- `/properties/[id]` is a **fully server-rendered, SEO-optimized** listing page with per-listing `<title>`, meta, OpenGraph, and **JSON-LD** for crawlers (`src/app/(app)/properties/[id]/page.tsx:1-38`). The sitemap emits **up to 45,000** of these (`sitemap.ts:18-33`) refreshed daily. Brokerage is displayed → TRREB-compliant. **This is the Realtor.ca-competition surface and it already exists.**
- BUT: (a) these pages are the *active IDX feed only* — the most valuable SEO query in Canadian real estate is **"[address] sold price"** and we (correctly, per compliance) cannot index sold pages. (b) There are **no neighbourhood / city / "investment analysis" landing pages** — the exact "hyperlocal programmatic SEO that beats portals market-by-market" that the PropTech playbook describes ([proptechbuzz SEO guide](https://www.proptechbuzz.com/blog/seo-for-proptech-companies)). (c) The **`/share/[token]` viral surface is `Disallow`-ed in robots** (`robots.ts:18`) — every shared analysis is a dead-end for SEO. We have a sharing primitive (`api/share/route.ts`, `src/components/CommandCenter/ShareDialog.tsx`) but it produces a private, no-index, no-CTA-loop page (`share/[token]/page.tsx` — its only CTA is a soft "Explore the terminal →," no "claim your own analysis," no referral credit).

### 3. There is NO referral / virality loop anywhere
- `grep referral|invite|waitlist` across `src/` returns **zero** growth-loop code. The "share" feature shares *listings to a recipient*, not *an invite that grants the sharer status or the recipient priority access*. Given we have a hand-verified velvet rope, **an invite is the single most natural and most wasted loop in the whole product.** Double-sided referral converts 2-3× single-sided and referred leads convert 3-5× ([waitlister guide](https://waitlister.me/growth-hub/guides/how-to-build-a-viral-referral-program-for-your-waitlist)); Dropbox drove 35% of signups via referral at **$0.25 CAC vs $233-388 paid** ([viral-loops Dropbox](https://viral-loops.com/blog/viral-loops-case-study-using-a-referral-waitlist-before-lunch-to-reduce-cac/)).

### 4. We have alert/watchlist infrastructure but no habit-forming hook surfaced for acquisition
- Watchlist + nightly email price-drop alerts already exist (per project memory: migration 015, `scripts/worker/alerts.ts`, `WatchButton.tsx`). This is the **retention/habit engine** HouseSigma uses (watchlist + alerts is one of their stickiest features). It's built but isn't part of the acquisition story — alerts are a reason to *come back daily*, which is what converts a tool into "the thing investors open with their coffee."

---

## My 3 boldest growth moves

### MOVE 1 — Flip the funnel: "Open Terminal, Locked Vault." Let everyone *touch* active data instantly; gate only what compliance requires.
**What:** Replace the homepage's single "Apply" wall with **drop-them-into-the-terminal** (`/properties` is already public + indexable). Anonymous users get the full active-listing terminal, sliders, map, and *deterministic* active-listing metrics (True DOM on active, price-compression vs list, carrying cost, cap-rate-on-list). The velvet rope tightens only at the **compliance line** — sold prices, AVM, sale history — exactly where the VOW gate already lives (`VowGateOverlay.tsx`). Keep the *application* as the unlock for the vault, so we still capture the rich intent data and stay VOW-compliant — but the user now applies *after* the magic moment, not before it.
- **Persona:** all four, but especially **Flipper/Deal Hunter** (sees stale-listing/price-compression signal immediately) and **Cashflow Investor** (cap-rate-on-list before sign-up).
- **Beats HouseSigma:** their free tier still nags you to register fast; our *active*-data terminal can be richer and faster (Typesense sub-50ms) than their listing view, and we convert on a *qualified* application instead of a junk email. TTV goes from ~3 minutes-of-forms to ~3 seconds.
- **Compliance flag:** LOW but MUST be vetted by `compliance` — the gate must still hard-block all VOW/sold/AVM output for anon users. I'm asserting active IDX terminal access for anon is already the shipped state (`robots.ts`, sitemap); compliance confirm there's no VOW leakage in the public terminal path.

### MOVE 2 — The "Deal Card" referral + share loop: every analysis becomes a shareable, attributed, indexable artifact.
**What:** Turn the existing share primitive into a growth engine on three axes:
1. **Referral invites with status + priority.** Because access is hand-verified, an invite is *valuable*. Give each verified user N **"Founding Member" invite codes**; invitee skips the review queue, inviter gets a status badge + early access to new metrics (tiered, like the Robinhood waitlist that hit 1M in a month — [viral-loops Robinhood](https://viral-loops.com/blog/robinhood-referral-got-1-million-users/)). Double-sided.
2. **Branded "Deal Card" share.** When a user runs the underwriting sandbox or AVM/Force-Appreciation analysis (`UnderwritingSandbox.tsx`, `ForceAppreciationCard.tsx`), let them export a clean **OG-image Deal Card** ("8.2% cap rate, True DOM 47d, $61k force-appreciation upside") with the PureProperty mark + the inviter's referral link. This is the unit that gets pasted into BiggerPockets/REIN threads, Slack/WhatsApp investor chats, and X. Compliance-safe because the *card* shows derived deterministic metrics, brokerage attribution, and is regenerated live — but **the AVM/sold-derived numbers on a public card need a compliance ruling** (see flags).
3. **Make the share page convert + (where allowed) index.** Add a real CTA ("Get this analysis on your own deals — request access") and referral attribution to `share/[token]/page.tsx`. Only index categories compliance clears (active-listing collections, not sold/AVM).
- **Persona:** **Flipper/Deal Hunter** and **Cashflow Investor** — they *already* screenshot deals into forums; we give them a better-looking, branded, self-promoting unit.
- **Beats HouseSigma:** HouseSigma's sharing is a bare listing link; ours is an *underwriting verdict* — a unique-insight artifact (quality bar: exposes insight they don't have). The referral loop is something HouseSigma, as an open free product, has no incentive structure for; our scarcity makes invites currency.
- **Compliance flag:** MEDIUM-HIGH on the Deal Card if it surfaces AVM/VOW-derived numbers publicly (memory: *VOW-derived AVM/Value-Add is GATED-USE ONLY; a public valuation tool risks revocation*). Needs `compliance` ruling: can a *user-generated, single-property* derived card be shared to a logged-out recipient? If not, the loop runs on **active-listing deterministic metrics only** (still strong) and the AVM card stays inside the gate.

### MOVE 3 — Programmatic "Investor Lens" SEO + a weekly "Sigma-Killer" market report as the top-of-funnel magnet.
**What:** Two coordinated content surfaces that capture intent *within VOW limits*:
1. **Programmatic neighbourhood/city investment pages** ("Cashflow in Hamilton: cap rates, True DOM, suite-conversion stock") built from **aggregated, anonymized active-listing + region-aggregate data** (we already have `region_aggregates`, migration 020). These are the hyperlocal pages that beat portals market-by-market ([winstonfrancois SEO/GEO](https://winstonfrancois.com/blog/seo-geo-for-real-estate-proptech/)). They rank for "[city] real estate investment / cap rate / cash flow" — queries Realtor.ca and HouseSigma *don't* target because they're consumer-listing-first.
2. **A weekly data-driven market report** (the channel HouseSigma itself uses — [HouseSigma ON reports](https://housesigma.com/on/reports)) distributed to the **email list we're already capturing** and seeded into **BiggerPockets Canada / REIN / Ontario investor Facebook groups** ([BiggerPockets Canada forum](https://www.biggerpockets.com/forums/48/topics/1211731-canadian-real-estate-investors)) — the exact watering holes for our personas. Each report ends with a Deal Card + invite code (feeds Move 2).
- **Persona:** **Cashflow Investor** + **Builder/Developer** (zoning/suite stock angle) for the programmatic pages; all four for the report.
- **Beats HouseSigma:** their reports are general market commentary; ours are **investor-decision-grade** (yield distributions, suite-potential supply, compression). We rank for the analytical long-tail they ignore. Aggregate stats sidestep the per-listing VOW gate.
- **Compliance flag:** MEDIUM — programmatic pages must use **aggregated active-listing / region stats only**, never per-property sold/AVM, never raw IDX/VOW through an LLM for copy (memory + §4). Needs `compliance` sign-off that aggregate active-listing yield/DOM stats on a public page are clear.

---

## Compliance items I need `compliance` to rule on (flagged for R1)
1. **(Move 1)** Confirm the anonymous public terminal path has zero VOW/sold/AVM leakage — i.e. flipping the homepage to drop-into-terminal exposes only active IDX + deterministic active metrics.
2. **(Move 2)** Can a user share a *single-property, user-triggered* Deal Card containing AVM / Value-Add (VOW-derived) numbers to a logged-out recipient? Or must every public card be active-listing-deterministic only?
3. **(Move 3)** Are **aggregated, anonymized** active-listing yield/DOM/region stats on a public, indexable SEO page acceptable, given they never expose a single sold record or per-property VOW output?

---

## The biggest fight I'll pick (preview for R1)
I will challenge any camp (likely `product-ux` or `compliance`) that defends **"keep the velvet rope at the front door."** My position: front-loaded friction with no recapture loop is the #1 growth killer here. The rope should move to the *compliance line*, and its scarcity should be monetized as **referral currency**, not spent as a generic signup wall. I'll also press `data-quant`: if the marquee cashflow fields (`gross_yield_est`/`cap_rate_est`/`cashflow`) are empty in the live index (per the brief + memory), then **my Deal Card and SEO yield pages have nothing to render** — the growth loop is downstream of their data being real and populated. That dependency needs to be on the critical path.

---

*Sources:* [HouseSigma About](https://housesigma.com/blog-en/about-us/) · [HouseSigma ON reports](https://housesigma.com/on/reports) · [proptechbuzz SEO for PropTech](https://www.proptechbuzz.com/blog/seo-for-proptech-companies) · [winstonfrancois SEO/GEO for PropTech](https://winstonfrancois.com/blog/seo-geo-for-real-estate-proptech/) · [waitlister referral guide](https://waitlister.me/growth-hub/guides/how-to-build-a-viral-referral-program-for-your-waitlist) · [viral-loops Dropbox case](https://viral-loops.com/blog/viral-loops-case-study-using-a-referral-waitlist-before-lunch-to-reduce-cac/) · [viral-loops Robinhood](https://viral-loops.com/blog/robinhood-referral-got-1-million-users/) · [BiggerPockets Canadian investors](https://www.biggerpockets.com/forums/48/topics/1211731-canadian-real-estate-investors)
